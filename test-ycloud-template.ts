import { readFileSync } from 'fs'

const envFile = readFileSync('.env', 'utf-8')
const env: Record<string, string> = {}
envFile.split('\n').forEach(line => {
    const [k, v] = line.split('=')
    if (k && v) env[k.trim()] = v.trim().replace(/^"|"$/g, '')
})

async function test() {
  const url = 'https://api.ycloud.com/v2/whatsapp/templates?name=test_template_1234'
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': '5f073f4864e560204f181b5256a1c1cd'
    }
  })
  
  console.log(res.status, await res.text())
}
test()
