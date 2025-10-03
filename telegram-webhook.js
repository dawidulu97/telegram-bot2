// api/telegram-webhook.js
export default async function handler(req, res) {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  async function tg(method, body) {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    return { ok: r.ok, status: r.status, text };
  }

  async function updateHWIDStatus(hwid, status) {
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
  }

  const pickHWID = (s) => (s && (s.match(/[A-Fa-f0-9]{64}/) || [])[0]) || null;

  try {
    if (req.method !== 'POST') return res.status(200).send('OK');
    const update = req.body;

    if (update?.callback_query) {
      const cq = update.callback_query;
      const [action, hwid] = String(cq.data || '').split(':');
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

    if (typeof update?.message?.text === 'string') {
      const msg = update.message;
      const text = msg.text.trim();
      const m = text.match(/^\/(approve|reject|hold)(?:\s+([A-Fa-f0-9]{64}))?$/i);
      if (m) {
        const map = { approve: 'approved', reject: 'rejected', hold: 'hold' };
        const status = map[m[1].toLowerCase()];
        let hwid = m[2] || null;
        if (!hwid && msg.reply_to_message?.text) hwid = pickHWID(msg.reply_to_message.text);
        if (!hwid) {
          await tg('sendMessage', { chat_id: msg.chat.id, text: '❌ Missing HWID. Reply to the HWID message with /approve or include the HWID.' });
        } else {
          await updateHWIDStatus(hwid, status);
          await tg('sendMessage', { chat_id: msg.chat.id, text: `✅ Status updated to ${status.toUpperCase()} for HWID ${hwid}` });
        }
        return res.status(200).send('OK');
      }
    }

    return res.status(200).send('OK');
  } catch (e) {
    console.error('Webhook error:', e?.message || String(e));
    return res.status(200).send('OK'); // keep Telegram webhook alive
  }
}