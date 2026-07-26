import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

/**
 * Send later.
 *
 * Delivery is pull-based: `deliver_due_messages()` flushes the whole due
 * queue, for every user, and any signed-in client may call it. So a message
 * scheduled overnight goes out when *anyone* next opens Wavo, rather than
 * waiting for its author to come back. The cost is that "9am" means "the
 * first time the app is used at or after 9am".
 */
const FLUSH_EVERY_MS = 60_000;

export function useScheduled({ userId, kind, conversationId, onDelivered }) {
  const [pending, setPending] = useState([]);

  const load = useCallback(async () => {
    if (!userId || !conversationId) {
      setPending([]);
      return;
    }
    const { data } = await supabase
      .from("scheduled_messages")
      .select("id, content, send_at, kind, conversation_id")
      .eq("sender_id", userId)
      .eq("conversation_id", String(conversationId))
      .is("delivered_at", null)
      .order("send_at");
    setPending(data || []);
  }, [userId, conversationId]);

  useEffect(() => {
    let live = true;
    (async () => {
      if (!live) return;
      await load();
    })();
    return () => {
      live = false;
    };
  }, [load]);

  // Flush on mount and on a timer while the tab is open. Cheap: the query is
  // an index scan over undelivered rows, and it no-ops when nothing is due.
  useEffect(() => {
    if (!userId) return undefined;
    let live = true;
    let timer;

    const flush = async () => {
      const { data } = await supabase.rpc("deliver_due_messages");
      if (!live) return;
      if (data > 0) {
        await load();
        onDelivered?.(data);
      }
    };

    (async () => {
      if (!live) return;
      await flush();
    })();
    timer = window.setInterval(flush, FLUSH_EVERY_MS);

    return () => {
      live = false;
      window.clearInterval(timer);
    };
    // onDelivered is a fresh closure each render; depending on it would
    // restart the interval constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, load]);

  const schedule = useCallback(
    async (content, sendAt, recipientId) => {
      const { error } = await supabase.rpc("schedule_message", {
        p_kind: kind,
        p_conversation_id: String(conversationId),
        p_recipient: kind === "dm" ? recipientId : null,
        p_content: content,
        p_send_at: sendAt.toISOString(),
      });
      if (error) return error.message;
      await load();
      return null;
    },
    [kind, conversationId, load]
  );

  const cancel = useCallback(
    async (id) => {
      const { error } = await supabase.rpc("cancel_scheduled_message", {
        p_id: id,
      });
      if (error) return error.message;
      await load();
      return null;
    },
    [load]
  );

  return { pending, schedule, cancel, reloadScheduled: load };
}
