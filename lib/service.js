/*
 * Wire
 * Copyright (C) 2017 Wire Swiss GmbH
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see http://www.gnu.org/licenses/.
 *
 */

const b64 = require('base64-arraybuffer');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const protobuf = require('protocol-buffers');
const uuidV1 = require('uuid/v1');

const BotInstance = require('./bot_instance');
const HttpsClient = require('./https_client');
const Otr = require('./otr_manager');
const util = require('./util');

class Service {
  constructor(options, cb) {
    this.bots = {};
    this.cb = cb;
    this.port = options.port;
    this.auth = options.auth;
    this.storePath = options.storePath;
    this.messages = protobuf(fs.readFileSync(path.resolve(__dirname, './messages.proto')));

    https.createServer({ key: fs.readFileSync(options.key),
      cert: fs.readFileSync(options.cert) }, (req, res) => {
      console.log(`req: ${req.method} url: ${req.url}`);
      if (req.method !== 'POST' || req.url.indexOf('/bots') !== 0) {
        Service.sendResponse(res, 404);
        return;
      }
      let data = [];
      req.on('data', (chunk) => {
        data.push(chunk);
      }).on('end', () => {
        data = Buffer.concat(data).toString();
        console.log(`got: ${data}`);
        let j;
        try {
          j = JSON.parse(data);
        } catch (e) {
          console.log(`Unexpected error: ${e}`);
          Service.sendResponse(res, 500);
          return;
        }
        this.handleRequest(req, j, res);
        j = JSON.stringify(j);
        console.log(`as json: ${j}`);
      });
    }).listen(this.port);
  }

  static sendResponse(res, code, data) {
    if (data === undefined) {
      res.writeHead(code);
      res.end();
    } else {
      res.writeHead(code, {
        'Content-Type':'application/json'
      });
      res.end(JSON.stringify(data));
    }
  }

  handleRequest(req, data, res) {
    console.log(`Handle request for url ${req.url}`);
    if (req.url === '/bots') {
      this.createBot(req, data, res);
    } else {
      const reqPath = req.url.split('/');
      if (reqPath.length > 2 && reqPath[1] === 'bots' && reqPath[3] === 'messages') {
        this.handleMessages(req, data, res, reqPath[2]);
      } else {
        console.log(`Unknown url ${req.url}`);
        Service.sendResponse(res, 404);
      }
    }
  }

  checkAuthHeader(req) {
    if (!{}.hasOwnProperty.call(req.headers, 'authorization')) {
      return false;
    }
    return req.headers.authorization === `Bearer ${this.auth}`;
  }

  createBot(req, data, res) {
    if (!this.checkAuthHeader(req)) {
      console.log(`Invalid auth header, expected ${this.auth}`);
      Service.sendResponse(res, 401);
    } else if (!Service.validateCreateBotData(data)) {
      console.log(`Invalid data for creating bot sent. Data: ${JSON.stringify(data)}`);
      Service.sendResponse(res, 404);
    } else {
      console.log('Creating new bot...');
      Service.createCryptoStuff(this.storePath, data.id, data.conversation.members.length)
        .then(([otr, preKeys]) => {
          const resObj = {
            prekeys: [],
          };
          for (let i = 0; i < preKeys.length; i++) {
            const str = new Buffer(preKeys[i]);
            console.log(str.toString('base64'));
            if (i !== (preKeys.length - 1)) {
              resObj.prekeys.push({ id: i, key: str.toString('base64') });
            } else {
              resObj.last_prekey = { id: 65535, key: str.toString('base64') };
            }
          }
          Service.sendResponse(res, 201, resObj);
          const httpsClient = new HttpsClient(data.token);
          this.bots[data.id] = {
            data,
            otr,
            httpsClient,
            botInstance: new BotInstance(data.id, this),
          };
          if (typeof this.cb === 'function') {
            this.cb(this.bots[data.id].botInstance);
          }
          this.saveState(data.id);
        });
    }
  }

  static validateCreateBotData(data) {
    if (Service.checkPropertyAndType(data, 'id', 'string') &&
      Service.checkPropertyAndType(data, 'client', 'string') &&
      Service.checkPropertyAndType(data, 'origin', 'object') &&
      Service.checkPropertyAndType(data, 'conversation', 'object') &&
      Service.checkPropertyAndType(data, 'token', 'string') &&
      Service.checkPropertyAndType(data, 'locale', 'string') &&
      Service.validateOrigin(data.origin) && Service.validateConversation(data.conversation)) {
      return true;
    }
    return false;
  }

  static checkPropertyAndType(obj, prop, type) {
    if ({}.hasOwnProperty.call(obj, prop)) {
      if (type === 'Array') {
        if (Array.isArray(obj[prop])) {
          return true;
        }
      }
      if (typeof obj[prop] === type) { // eslint-disable-line
        if (type === 'object' && obj[prop] !== null && !Array.isArray(obj[prop])) {
          return true;
        }
        if (type !== 'object') {
          return true;
        }
      }
    }
    return false;
  }

  static validateOrigin(origin) {
    if (Service.checkPropertyAndType(origin, 'id', 'string') &&
      Service.checkPropertyAndType(origin, 'name', 'string') &&
      Service.checkPropertyAndType(origin, 'accent_id', 'number')) {
      return true;
    }
    return false;
  }

  static validateConversation(conversation) {
    if (Service.checkPropertyAndType(conversation, 'id', 'string') &&
      Service.checkPropertyAndType(conversation, 'members', 'Array') &&
      Service.validateMembers(conversation.members)) { // name is optional property
      return true;
    }
    return false;
  }

  static validateMembers(members) {
    for (let i = 0; i < members.length; i++) {
      if (!Service.checkPropertyAndType(members[i], 'id', 'string') ||
        !Service.checkPropertyAndType(members[i], 'status', 'number')) {
        // service is optional property
        return false;
      }
    }
    return true;
  }

  handleMessages(req, data, res, botID) {
    if (!this.checkAuthHeader(req)) {
      console.log(`Invalid auth header, expected ${this.auth}`);
      Service.sendResponse(res, 401);
    } else if (typeof botID !== 'string' || !Service.validateMessages(data)) {
      Service.sendResponse(res, 404);
    } else if (!{}.hasOwnProperty.call(this.bots, botID)) {
      this.loadState(botID)
        .then((result) => {
          if (!result) {
            Service.sendResponse(res, 404);
          } else {
            if (typeof this.cb === 'function') {
              this.cb(this.bots[botID].botInstance);
            }
            this.handleMessagesImpl(req, data, res, botID);
          }
        });
    } else if (this.bots[botID].data.conversation.id !== data.conversation) {
      console.log('Invalid data for message handling sent.' +
      `Bot: ${botID}, data: ${JSON.stringify(data)}`);
      Service.sendResponse(res, 404);
    } else {
      this.handleMessagesImpl(req, data, res, botID);
    }
  }

  handleMessagesImpl(req, data, res, botID) {
    console.log(`Message request for bot ${botID}, data: ${JSON.stringify(data)}`);
    if (data.type === 'conversation.otr-message-add') {
      this.conversationMessageAdd(req, data, res, botID);
    } else if (data.type === 'conversation.member-join') {
      this.conversationMemberJoin(req, data.data, res, botID);
    } else if (data.type === 'conversation.member-leave') {
      this.conversationMemberLeave(req, data.data, res, botID);
    } else if (data.type === 'conversation.rename') {
      this.conversationRename(req, data.data, res, botID);
    } else { // unknown data type
      Service.sendResponse(res, 404);
    }
  }

  static validateMessages(msg) {
    if (Service.checkPropertyAndType(msg, 'type', 'string') &&
      Service.checkPropertyAndType(msg, 'conversation', 'string') &&
      Service.checkPropertyAndType(msg, 'from', 'string') &&
      Service.checkPropertyAndType(msg, 'data', 'object')) {
      return true;
    }
    return false;
  }

  conversationMessageAdd(req, data, res, botID) {
    const self = this;
    if (!Service.validateConversationMessageAdd(data.data)) {
      console.log('Invalid data for conversation message add sent.' +
      `Bot: ${botID}, data: ${JSON.stringify(data.data)}`);
      Service.sendResponse(res, 404);
    } else {
      Service.sendResponse(res, 200);

      console.log(`New message for bot ${botID}, data: ${JSON.stringify(data)}`);
      const msg = data.data.text; // user's message
      this.bots[botID].otr.decrypt(data.from, data.data.sender, msg)
        .then((plainText) => {
          const buf = new Buffer(plainText);
          const pb = self.messages.GenericMessage.decode(buf);
          console.log(`got plain text ${JSON.stringify(pb)}`);

          this.sendConfirmation(botID, pb.message_id, (confirmationStatus) => {
            console.log(`message confirmation sent with status ${confirmationStatus}`);
            if ({}.hasOwnProperty.call(pb, 'text')) {
              this.bots[botID].botInstance.onMessage(data.from, pb);
            } else if ({}.hasOwnProperty.call(pb, 'asset') &&
            {}.hasOwnProperty.call(pb.asset, 'original') &&
              pb.asset.original != null &&
            {}.hasOwnProperty.call(pb.asset.original, 'image') &&
            pb.asset.original.image != null) {
              this.bots[botID].botInstance.onImage(data.from, pb);
            }
            // else
          });
        });
    }
  }

  static validateConversationMessageAdd(data) {
    if (Service.checkPropertyAndType(data, 'sender', 'string') &&
      Service.checkPropertyAndType(data, 'recipient', 'string') &&
      Service.checkPropertyAndType(data, 'text', 'string')) { // data is optional property
      return true;
    }
    return false;
  }

  conversationMemberJoin(req, data, res, botID) {
    // todo: Verify that it has at least 8 prekeys left on Wire for the new user
    // (besides the last resort prekey) and if necessary refresh its prekeys.
    // todo: Fetch prekeys and initialise sessions with all clients of the new user,
    // immediately followed by sending a message.
    if (!Service.validateConversationMemberJoinLeave(data)) {
      console.log('Invalid data for conversation member join sent.' +
        `Bot: ${botID}, data: ${JSON.stringify(data)}`);
      Service.sendResponse(res, 404);
    } else {
      console.log(`Conversation member join for bot ${botID}, data: ${JSON.stringify(data)}`);
      const newMembers = data.user_ids;
      console.log(`New members [${newMembers}] joined conversation` +
        `${this.bots[botID].data.conversation.id}`);
      let selfAdded = false;
      for (let i = 0; i < newMembers.length; i++) {
        this.bots[botID].data.conversation.members.push({ id: newMembers[i], status: 0 });
        if (botID === newMembers[i]) {
          selfAdded = true;
        }
      }
      Service.sendResponse(res, 200);

      if (selfAdded) {
        // get devices if we have none
        if (!{}.hasOwnProperty.call(this.bots, 'devices')) {
          console.log('will try to retrieve devices for me...');
          this.getDevices(botID, (devices, status) => {
            console.log(`getDevices response: ${JSON.stringify(devices)}`);
            if (status === 412 && Service.validateDevices(devices)) {
              this.bots[botID].devices = devices.missing;
              console.log('got devices!');
            }
            this.bots[botID].botInstance.onConversationMemberJoin(newMembers,
              this.bots[botID].data.conversation);
          });
        }
      } else {
        this.bots[botID].botInstance.onConversationMemberJoin(newMembers,
          this.bots[botID].data.conversation);
      }
    }
  }

  static validateConversationMemberJoinLeave(data) {
    return Service.checkPropertyAndType(data, 'user_ids', 'Array');
  }

  conversationMemberLeave(req, data, res, botID) {
    if (!Service.validateConversationMemberJoinLeave(data)) {
      console.log('Invalid data for conversation member leave sent.' +
        `Bot: ${botID}, data: ${JSON.stringify(data)}`);
      Service.sendResponse(res, 404);
    } else {
      console.log(`Conversation member leave for bot ${botID}, data: ${JSON.stringify(data)}`);
      const membersToRemove = data.user_ids;
      if (membersToRemove.indexOf(botID) !== -1) { // bot among the user_ids, delete any saved data
        delete this.bots[botID];
      } else {
        console.log(`Members [${membersToRemove}] left conversation` +
          `${this.bots[botID].data.conversation.id}`);
        for (let i = 0; i < membersToRemove.length; i++) {
          const oldBotMembers = this.bots[botID].data.conversation.members;
          for (let j = 0; j < oldBotMembers.length; j++) {
            if (oldBotMembers[j].id === membersToRemove[i]) {
              oldBotMembers.splice(j, 1);
            }
          }
        }
      }
      Service.sendResponse(res, 200);
      this.bots[botID].botInstance.onConversationMemberLeave(membersToRemove,
        this.bots[botID].data.conversation);
    }
  }

  conversationRename(req, data, res, botID) {
    if (!Service.checkPropertyAndType(data, 'name', 'string')) {
      console.log('Invalid data for conversation rename leave sent.' +
        `Bot: ${botID}, data: ${JSON.stringify(data)}`);
      Service.sendResponse(res, 404);
    } else {
      console.log(`Conversation rename for bot ${botID}, data: ${JSON.stringify(data)}`);
      this.bots[botID].data.conversation.name = data.name;
      Service.sendResponse(res, 200);
      this.bots[botID].botInstance.onConversationRename(data.name,
        this.bots[botID].data.conversation);
    }
  }

  getDevices(botID, cb) {
    this.bots[botID].httpsClient.sendMessage({ sender: this.bots[botID].data.client,
      recipients: {} }, false, cb);
  }

  static validateDevices(response) {
    return Service.checkPropertyAndType(response, 'missing', 'object');
  }

  // sends message
  sendMessage(botID, message, cb) {
    const pb = this.messages.GenericMessage.encode(message);

    const msg = {
      sender: this.bots[botID].data.client,
      recipients: {},
    };

    const promises = this.bots[botID].otr.encryptForDevices(this.bots[botID].devices,
      util.toArrayBuffer(pb));
    Promise.all(promises)
      .then((cyphers) => {
        cyphers.forEach((elem) => {
          const [uid, cid, cypher] = elem;
          if (cypher === null) {
            return;
          }
          if (!{}.hasOwnProperty.call(msg.recipients, uid)) {
            msg.recipients[uid] = {};
          }
          if (!{}.hasOwnProperty.call(msg.recipients[uid], cid)) {
            msg.recipients[uid][cid] = {};
          }
          msg.recipients[uid][cid] = b64.encode(cypher);
        });

        console.log(`send message ${JSON.stringify(msg)}`);
//todo: add botid validation
        this.bots[botID].httpsClient.sendMessage(msg, false, (response, status) => {
          if (status === 412) { // we are missing devices
            this.bots[botID].httpsClient.getPrekeys(response.missing, (pResponse, pStatus) => {
              // encrypt with prekeys
              if (pStatus === 200) {
                const p = [];
                Object.keys(pResponse).forEach((i) => {
                  Object.keys(pResponse[i]).forEach((j) => {
                    p.push(this.bots[botID].otr.encrypt(i, j,
                      b64.decode(pResponse[i][j].key), util.toArrayBuffer(pb)));
                  });
                });
                Promise.all(p)
                  .then((cyp) => {
                    console.log(cyp);
                    Object.keys(cyp).forEach((i) => {
                      const [uid, cid, cypher] = cyp[i];
                      if (!{}.hasOwnProperty.call(msg.recipients, uid)) {
                        msg.recipients[uid] = {};
                      }
                      if (!{}.hasOwnProperty.call(msg.recipients[uid], cid)) {
                        msg.recipients[uid][cid] = {};
                      }
                      msg.recipients[uid][cid] = b64.encode(cypher);
                    });
                    console.log(`to send ${JSON.stringify(msg)}`);
                    this.bots[botID].httpsClient.sendMessage(msg, false, (a, b) => {
                      console.log(`status ${b}`);
                      cb(b);
                    });
                  });
              }
            });
          } else {
            cb(status);
          }
        });
      });
  }

  getAsset(botID, assetID, assetToken, decryptKey, sha256, cb) {
    this.bots[botID].httpsClient.getAsset(assetID, assetToken, (data, status) => {
      console.log(`getAsset status: ${status}`);
      if (status >= 200 && status < 300) {
        const dKey = new Uint8Array(decryptKey);
        const keyBuffer = Buffer.from(dKey);
        const sha = new Uint8Array(sha256);
        const shaBuffer = Buffer.from(sha);
        const iv = Buffer.alloc(16);
        data.copy(iv, 0, 0, 16);
        const rest = Buffer.alloc(data.length - 16);
        data.copy(rest, 0, 16);
        const cipher = crypto.createDecipheriv('aes-256-cbc', keyBuffer, iv);
        const c1 = cipher.update(rest);
        const final = Buffer.concat([c1, cipher.final()]);
        const hash = crypto.createHash('sha256');
        hash.update(data);
        const hb = hash.digest();
        console.log('hash match', hb.length, shaBuffer.length, hb.compare(shaBuffer));
        cb(final, status);
      } else {
        cb(null, status);
      }
    });
  }

  uploadAsset(botID, data, cb) {
    if (!{}.hasOwnProperty.call(this.bots, botID)) throw new Error('Invalid bot ID');
    this.bots[botID].httpsClient.uploadAsset(data, (rd, re) => {
      console.log(`upload completed ${rd} ${re}`);
      cb(rd, re);
    });
  }

  sendConfirmation(botID, messageID, cb) {
    const confirmation = {
      message_id: uuidV1(),
      confirmation: {
        message_id: messageID,
        type: this.messages.Confirmation.Type.DELIVERED,
      },
    };
    this.sendMessage(botID, confirmation, cb);
  }

  loadState(botID) {
    return new Promise((resolve) => {
      const storePath = path.join(this.storePath, botID, 'bot_data.json');
      try {
        const content = fs.readFileSync(storePath, 'utf-8');
        const data = JSON.parse(content);
        console.log(`read from file ${JSON.stringify(data)}`);
        const httpsClient = new HttpsClient(data.token);
        this.bots[botID] = {
          data,
          otr: new Otr(this.storePath, botID),
          httpsClient,
          botInstance: new BotInstance(botID, this),
        };
        this.getDevices(botID, (devices, status) => {
          console.log(`getDevices response: ${JSON.stringify(devices)}`);
          if (status === 412 && Service.validateDevices(devices)) {
            this.bots[botID].devices = devices.missing;
            console.log('got devices!');
            this.bots[botID].otr.initWithNoKeys()
              .then(() => {
                resolve(true);
              });
          }
        });
      } catch (err) {
        resolve(false);
      }
    });
  }

  saveState(botID) {
    const storePath = path.join(this.storePath, botID, 'bot_data.json');
    fs.writeFileSync(storePath, JSON.stringify(this.bots[botID].data));
  }

  static createCryptoStuff(storePath, botID, numberOfKeys) {
    return new Promise((resolve) => {
      const otr = new Otr(storePath, botID);
      otr.init(numberOfKeys)
        .then((preKeys) => {
          resolve([otr, preKeys]);
        });
    });
  }
}

module.exports = {
  createService(options, cb) {
    return new Service(options, cb);
  },
};
