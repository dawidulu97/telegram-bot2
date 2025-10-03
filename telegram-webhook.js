export default async function handler(req, res) {
  // 1) Enforce Telegram secret token (optional but recommended)
  const secret = process.env.WEBHOOK_SECRET_TOKEN;
  if (secret) {
    const got = req.headers['x-telegram-bot-api-secret-token'];
    if (!got || got !== secret) return res.status(200).send('OK'); // ignore silently
  }

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID; // string, e.g. "7557313062" or "-1001234567890"

  const asStr = (v) => (typeof v === 'number' ? String(v) : (v || ''));

  const tg = async (method, body) => {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { ok: r.ok, status: r.status, text: await r.text() };
  };

  const updateHWIDStatus = async (hwid, status) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/hwid_approvals?hwid=eq.${encodeURIComponent(hwid)}`, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ status }),
    });
    if (!r.ok) throw new Error(`Supabase PATCH ${r.status} ${await r.text()}`);
  };

  const pickHWID = (s) => (s && (s.match(/[A-Fa-f0-9]{64}/) || [])[0]) || null;

  try {
    if (req.method !== 'POST') return res.status(200).send('OK');
    const update = req.body;

    // 2) For callback queries (inline buttons), allow only if the message chat is your ADMIN_CHAT_ID
    if (update?.callback_query) {
      const cq = update.callback_query;
      const chatIdStr = asStr(cq?.message?.chat?.id);
      if (!ADMIN_CHAT_ID || chatIdStr !== ADMIN_CHAT_ID) {
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Not authorized' });
        return res.status(200).send('OK');
      }

      const data = String(cq.data || '');
      const [action, hwid] = data.split(':');
      const map = { approve: 'approved', reject: 'rejected', hold: 'hold' };
      const status = map[action];
      if (!status || !hwid) {
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Invalid action' });
        return res.status(200).send('OK');
      }

      await updateHWIDStatus(hwid, status);
      await tg('answerCallbackQuery', { callback_query_id: cq.id, text: `HWID ${status}` });

      const emoji = { approved: '✅', rejected: '❌', hold: '⏸️' }[status];
      await tg('editMessageText', {
        chat_id: cq.message.chat.id,
        message_id: cq.message.message_id,
        text: `${emoji} HWID ${status.toUpperCase()}\n\nHWID: ${hwid}\n\nUpdated at ${new Date().toISOString()}`,
      });
      return res.status(200).send('OK');
    }

    // 3) Command fallbacks: only accept if message chat is the admin chat
    if (typeof update?.message?.text === 'string') {
      const msg = update.message;
      const chatIdStr = asStr(msg?.chat?.id);
      if (!ADMIN_CHAT_ID || chatIdStr !== ADMIN_CHAT_ID) {
        // ignore silently for non-admin chats
        return res.status(200).send('OK');
      }

      const text = msg.text.trim();
      const m = text.match(/^\/(approve|reject|hold)(?:\s+([A-Fa-f0-9]{64}))?$/i);
      if (m) {
        const action = m[1].toLowerCase();
        let hwid = m[2] || null;
        if (!hwid && msg.reply_to_message?.text) hwid = pickHWID(msg.reply_to_message.text);

        if (!hwid) {
          await tg('sendMessage', { chat_id: msg.chat.id, text: '❌ Missing HWID. Reply to the HWID message with /approve or include the HWID.' });
        } else {
          const map = { approve: 'approved', reject: 'rejected', hold: 'hold' };
          await updateHWIDStatus(hwid, map[action]);
          await tg('sendMessage', { chat_id: msg.chat.id, text: `✅ Status updated to ${map[action].toUpperCase()} for HWID ${hwid}` });
        }
        return res.status(200).send('OK');
      }
    }

    return res.status(200).send('OK');
  } catch (e) {
    console.error('Webhook error:', e?.message || String(e));
    return res.status(200).send('OK');
  }
}