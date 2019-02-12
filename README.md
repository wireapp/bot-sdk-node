# Wire™

![Wire logo](https://github.com/wireapp/wire/blob/master/assets/logo.png?raw=true)

## Wire Bot Node.js

Wire bot API is currently in alpha.

### Bot registration and creation

* Run `manage.sh` from a terminal and register as Wire Service Provider

* Register as Wire Service Provider:
  - Email - This is a separate developer account, you can reuse the same email (if you've added an email to your Wire account)
  - Website (you can leave it blank: `https://`)
  - Developer description (e.g. “Pied Piper”)
  - Verification email
  - Account approved email (will happen immediatelly)

* Create a new service with `new-service` command
  - Name - name of the bot, will also be used as the URL for the bot
  - Base URL (you can put: `https://[Your_Public_IP]:8050`)
  - Description
  - Copy and paste the RSA key (found in `./hello-bot/certs/pubkey.pem`) $ADD?

* Enable your service with `update-service-conn` command

### Installation

```bash
git clone https://github.com/wireapp/bot-sdk-node/
npm install bot-sdk-node
```

### Usage

Create service key and certificate:

```bash
openssl genrsa -out server.key 4096
openssl req -new -key server.key -out csr.pem
openssl x509 -req -days 7300 -in csr.pem -signkey server.key -out server.crt
openssl rsa -in server.key -pubout -out pubkey.pem
```

Then proceed to create your first bot (take a look at example/echo_text_bot.js):
```javascript
const service = require('wire-bot-sdk-node');

service.createService(options, (bot) => {
  // add listeners
});
```

* The `options` argument has the following options:
  - port - https server port (serve on which wire will send requests),
  - key - https server private key (server.key created above),
  - cert - https server certificate (server.crt created above),
  - auth - *auth_token* that you received from DevBot
  - storePath - file system path where cryptobox stuff will be stored

* The function that is passed to `createService` is called when the service is created and is given a bot instance. Bot object is an `EventEmitter` and emits the following listeners:

  - `bot.on('message', (from, message) => {}); // message from user`
  - `bot.on('join', (members, conversation) => {}); // new user(s) joined the conversation`
  - `bot.on('leave', (members, conversation) => {}); // user(s) that left the conversation`
  - `bot.on('rename', (name, conversation) => {}); // conversation renamed`

Use `sendMessage` to send message back to user

```javascript
bot.sendMessage(message, (sendStatus) => {});
```
