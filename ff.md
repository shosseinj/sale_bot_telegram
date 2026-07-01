TELEGRAM_WEBHOOK_SECRET

```
node -e "console.log(crypto.randomUUID() + '-' + crypto.randomUUID())"
```

c59137fc-221d-4813-97ae-d931ec816a3b-a5dcf353-f14a-45bb-bf97-c9fed35df0ac

TELEGRAM_BOT_TOKEN
8749301295:AAHLB4zseNfGQWb6ZJAGwT2DqGi8aQaMsGM

ADMIN_TOKEN
ac336b67-1b03-45f0-9a81-f6c5d29eda2b-264a7db5-e034-4972-abff-cede79f75c1f
```
node -e "console.log(crypto.randomUUID() + '-' + crypto.randomUUID())"
```




$workerUrl = "https://ai-sales-assistant-worker.hossein97jafari.workers.dev"
$adminToken = "ac336b67-1b03-45f0-9a81-f6c5d29eda2b-264a7db5-e034-4972-abff-cede79f75c1f"

Invoke-RestMethod -Uri "$workerUrl/api/admin/stats" `
  -Headers @{
    Authorization = "Bearer $adminToken"
  }


  <!--  -->


$botToken = "c59137fc-221d-4813-97ae-d931ec816a3b-a5dcf353-f14a-45bb-bf97-c9fed35df0ac"
$workerUrl = "https://ai-sales-assistant-worker.hossein97jafari.workers.dev"
$secret = "c59137fc-221d-4813-97ae-d931ec816a3b-a5dcf353-f14a-45bb-bf97-c9fed35df0ac"

Invoke-RestMethod -Method Post `
  -Uri "https://api.telegram.org/bot$botToken/setWebhook" `
  -Body @{
    url = "$workerUrl/telegram/webhook"
    secret_token = $secret
  }



  $workerUrl = "https://ai-sales-assistant-worker.hossein97jafari.workers.dev"
$adminToken = "ADMIN_TOKEN_خودت"

Invoke-RestMethod -Method Post `
  -Uri "$workerUrl/api/admin/telegram/set-webhook" `
  -Headers @{
    Authorization = "Bearer $adminToken"
  }