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

const cryptobox = require('cryptobox');
const FileStore = require('./file_store');
const util = require('./util');

module.exports = class OtrManager {
  constructor(storePath, botID) {
    this.storePath = storePath;
    this.botID = botID;
  }

  init(keys) {
    const self = this;
    return new Promise((resolve) => {
      const a = new cryptobox.Cryptobox(new FileStore(this.storePath, this.botID));
      a.then((box) => {
        console.log('got cryptobox');
        self.box = box;
        const promises = [];
        for (let i = 0; i < 8 * keys; ++i) {
          promises.push(box.new_prekey(i));
        }
        promises.push(box.new_prekey(65535));
        Promise.all(promises)
          .then((serializedPreKeyBundles) => {
            resolve(serializedPreKeyBundles);
          });
      });
    });
  }

  initWithNoKeys() {
    return new Promise((resolve) => {
      const a = new cryptobox.Cryptobox(new FileStore(this.storePath, this.botID));
      a.then((box) => {
        console.log('got cryptobox');
        this.box = box;
        resolve();
      });
    });
  }

  encryptForDevices(devices, data) {
    const ret = [];
    Object.keys(devices).forEach((key) => {
      devices[key].forEach((client) => {
        const id = `${key}_${client}`;
        ret.push(new Promise((resolve) => {
          this.box.session_load(id)
            .then((session) => {
              if (session === null) {
                resolve([key, client, null]);
              } else {
                let cypher;
                session.encrypt(data)
                  .then((c) => {
                    cypher = c;
                    return this.box.session_save(session);
                  })
                  .then(() => {
                    resolve([key, client, cypher]);
                  });
              }
            });
        }));
      });
    });
    return ret;
  }

  encrypt(userId, clientId, preKey, data) {
    const id = `${userId}_${clientId}`;
    return new Promise((resolve) => {
      let cypher;
      this.box.session_load(id)
        .then((session) => {
          if (session === null) {
            console.log('couldn\'t find session');
            let s;
            this.box.session_from_prekey(id, preKey)
              .then((newSession) => {
                console.log(`got session from prekey ${newSession}`);
                s = newSession;
                return s.encrypt(data);
              })
              .then((c) => {
                cypher = c;
                return this.box.session_save(s);
              })
              .then(() => resolve([userId, clientId, cypher]));
          } else {
            session.encrypt(data)
              .then((c) => {
                cypher = c;
                return this.box.session_save(session);
              })
              .then(() => resolve([userId, clientId, cypher]));
          }
        });
    });
  }

  decrypt(userId, clientId, cypher) {
    const id = `${userId}_${clientId}`;
    const data = Buffer.from(cypher, 'base64');
    let plainData;
    return new Promise((resolve) => {
      this.box.session_load(id)
        .then((session) => {
          if (session === null) {
            console.log('couldn\'t find session');
            return this.box.session_from_message(id, util.toArrayBuffer(data))
              .then(([newSession, plain]) => {
                plainData = plain;
                console.log(`got session ${newSession}`);
                return this.box.session_save(newSession);
              })
              .then(() => {
                console.log(`plain ${plainData}`);
                return resolve(plainData);
              });
          }
          return session.decrypt(util.toArrayBuffer(data))
            .then((plain) => {
              plainData = plain;
              return this.box.session_save(session);
            })
            .then(() => resolve(plainData));
        });
    });
  }

  box() {
    return this.box;
  }
};
