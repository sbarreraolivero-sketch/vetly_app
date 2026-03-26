import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const url = `${process.env.VITE_SUPABASE_URL}/functions/v1/ycloud-whatsapp-webhook`;
  const data = {
    type: "whatsapp.message",
    whatsappConfigId: "ycloud_id", // might be something else
    message: {
      from: "+56926950364",
      to: "ycloud_id",
      type: "text",
      text: { body: "Hola" }
    }
  };
  console.log('Sending to', url);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  console.log(res.status, await res.text());
}
run();
