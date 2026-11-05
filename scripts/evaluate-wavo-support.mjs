#!/usr/bin/env node
// Explicit opt-in, synthetic-only OpenAI comparison. DOES NOT use customer data.
// Example:
// SUPPORT_EVAL_CONFIRM=yes OPENAI_API_KEY=... node scripts/evaluate-wavo-support.mjs
// Never put keys into GitHub Actions logs or source control.
import { SUPPORT_ANSWER_CASES } from "../tests/supportAnswerCases.mjs";
import { billingGuidance } from "../supabase/functions/support-ai/supportBilling.mjs";
import { buildSupportInstructions } from "../supabase/functions/support-ai/supportInstructions.mjs";
import { estimateSupportCostUsd, isSupportResponseComplete, resolveCompatibleReasoning } from "../supabase/functions/support-ai/supportEconomics.mjs";
import { extractSupportResponseText, supportInput, supportReasoningEffort } from "../supabase/functions/support-ai/supportUtils.mjs";

const models=["gpt-5.6-luna","gpt-6-luna"];
const maxSpendUsd=0.10;
const isEnabled=process.env.SUPPORT_EVAL_CONFIRM==="yes" && !!process.env.OPENAI_API_KEY;
if (!isEnabled) {
  console.log(`Dry run: ${SUPPORT_ANSWER_CASES.length} synthetic cases × ${models.length} models. No API calls made.`);
  console.log("To run explicitly: SUPPORT_EVAL_CONFIRM=yes OPENAI_API_KEY=<secret> node scripts/evaluate-wavo-support.mjs");
  process.exit(0);
}
let totalCost=0,failed=0,flagged=0;
const results=[];
for (const item of SUPPORT_ANSWER_CASES) {
  for (const model of models) {
    const instructions=buildSupportInstructions({
      supportVersion:"v16",
      platform:item.platform,
      accountContext:"AUTHENTICATED ACCOUNT: synthetic-evaluation-user; no admin flag.",
      billingRule:billingGuidance(item.platform),
      kb:item.kb,
      currentDate:"2026-10-23",
    });
    const reasoningEffort=resolveCompatibleReasoning(model,supportReasoningEffort(item.question));
    const input=supportInput(item.question,item.history || []);
    const maxOutputTokens=reasoningEffort==="medium"?850:650;
    // Conservative preflight cap uses a deliberately high input-token bound.
    const proposedTokens=Math.max(500,2*(instructions.length+input.length));
    const projected=estimateSupportCostUsd(model,{input_tokens:proposedTokens,output_tokens:maxOutputTokens});
    if (projected===null || totalCost + projected > maxSpendUsd) {
      console.error(`Stopped at hard preflight budget USD ${maxSpendUsd}; current estimated spend ${totalCost.toFixed(6)}.`);
      process.exit(2);
    }
    let data;
    try {
      const res=await fetch("https://api.openai.com/v1/responses",{
        method:"POST",
        headers:{"content-type":"application/json",authorization:`Bearer ${process.env.OPENAI_API_KEY}`},
        body:JSON.stringify({model,reasoning:{effort:reasoningEffort},max_output_tokens:maxOutputTokens,
          instructions,input,store:false}),
        signal:AbortSignal.timeout(22_000),
      });
      if(!res.ok)throw new Error(`Upstream HTTP ${res.status}`);
      data=await res.json();
    } catch(e) {
      failed++;
      results.push({test:item.id,model,result:"ERROR",cost:"-",notes:e instanceof Error?e.message:"Request failed"});
      continue;
    }
    const cost=estimateSupportCostUsd(model,data.usage);
    // Unreported usage is not silently treated as free.
    if(cost===null){
      console.error("Model omitted usage; stopping costed evaluation.");
      process.exit(2);
    }
    totalCost+=cost;
    const reply=extractSupportResponseText(data);
    const lower=reply.toLowerCase();
    const issues=[];
    if(!isSupportResponseComplete(data)||!reply)issues.push("Empty/incomplete");
    for(const value of item.expected || []){
      if(!lower.includes(value.toLowerCase()))issues.push(`Missing: ${value}`);
    }
    for(const value of item.forbidden || []){
      if(lower.includes(value.toLowerCase()))issues.push(`Unexpected: ${value}`);
    }
    if(issues.length)flagged++;
    results.push({test:item.id,model,result:issues.length?"REVIEW":"PASS",cost:cost.toFixed(6),notes:issues.join("; ")});
    if(process.env.SUPPORT_EVAL_SHOW_REPLIES==="1")console.log(`\n[${item.id} / ${model}] ${reply}\n`);
  }
}
console.table(results);
console.log(`Finished ${results.length} synthetic prompts. Estimated API spend USD ${totalCost.toFixed(6)} of ${maxSpendUsd}. ${flagged} flagged for review, ${failed} request failures.`);
console.log("Automated checks are only a screening tool: review answers manually for factual accuracy, friendliness, and helpfulness.");
if(failed)process.exitCode=1;
