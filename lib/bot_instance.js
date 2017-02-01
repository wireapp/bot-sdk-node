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

const crypto = require('crypto');
const EventEmitter = require('events').EventEmitter;
const uuidV1 = require('uuid/v1');

module.exports = class BotInstance extends EventEmitter {
  constructor(botID, service) {
    super();
    this.botID = botID;
    this.service = service;
  }

  onMessage(from, message) {
    this.emit('message', from, message);
  }

  onImage(from, asset) {
    this.emit('image', from, asset);
  }

  onConversationMemberJoin(members, conversation) {
    this.emit('join', members, conversation);
  }

  onConversationMemberLeave(members, conversation) {
    this.emit('leave', members, conversation);
  }

  onConversationRename(name, conversation) {
    this.emit('rename', name, conversation);
  }

  sendMessage(message, cb) {
    const msg = {
      message_id: uuidV1(),
      text: {
        content: message,
        mention: [],
        link_preview: [],
      },
    };
    this.service.sendMessage(this.botID, msg, cb);
  }

  sendImage(data, mimeType, meta, cb) {
    BotInstance.encrypt(data, (encData, otrKey, iv, sha256) => {
      console.log(`len of enc data ${encData.length}`);
      const j = {
        public: false,
        retention: 'volatile',
      };
      const js = JSON.stringify(j);

      const hash = crypto.createHash('md5');
      hash.update(encData);
      const h = hash.digest('base64');

      let d = '--frontier\r\n';
      d += 'Content-Type: application/json; charset=utf-8\r\n';
      d += `Content-Length: ${js.length}\r\n\r\n`;
      d += `${js}\r\n`;

      d += '--frontier\r\n';
      d += `Content-Type: ${mimeType}\r\n`;
      d += `Content-Length: ${encData.length}\r\n`;
      d += `Content-MD5: ${h}\r\n\r\n`;

      const final = Buffer.concat([Buffer.from(d), encData, Buffer.from('\r\n--frontier--\r\n')]);

      this.service.uploadAsset(this.botID, final, (rd, re) => {
        console.log(`upload completed2 ${rd} ${re}`);
        if (re >= 200 && re < 300) {
          // upload successful
          const json = JSON.parse(rd.toString('utf8')); // fixme: try/catch
          this.service.sendMessage(this.botID, {
            message_id: uuidV1(),
            asset: {
              original: {
                mime_type: mimeType,
                size: data.length,
                image: {
                  width: meta.width,
                  height: meta.height,
                },
              },
              uploaded: {
                otr_key: otrKey,
                sha256,
                asset_id: json.key,
                asset_token: json.token,
              },
            },
          }, cb);
        }
      });
    });
  }

  getAsset(assetID, assetToken, decryptKey, sha256, cb) {
    this.service.getAsset(this.botID, assetID, assetToken, decryptKey, sha256, cb);
  }

  // generate random key (32 bytes) and random iv (16 bytes)
  static encrypt(data, cb) {
    crypto.randomBytes(32, (e1, key) => {
      if (e1) throw e1;
      crypto.randomBytes(16, (e2, iv) => {
        if (e2) throw e2;
        const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        const final = Buffer.concat([iv, cipher.update(data), cipher.final()]);
        const hash = crypto.createHash('sha256');
        hash.update(final);
        const hb = hash.digest();
        cb(final, key, iv, hb);
      });
    });
  }
};
