import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.105.4";
import { createSupportHandler } from "./supportHandler.ts";

Deno.serve(createSupportHandler({ createClient }));
