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
const fs = require('fs');
const path = require('path');
const Proteus = require('wire-webapp-proteus');

const util = require('./util');

module.exports = class FileStore extends cryptobox.CryptoboxStore {
  constructor(storePath, botID) {
    super();
    this.storePath = storePath;
    this.botID = botID;
    this.initStore();
  }

  initStore() {
    if (!fs.existsSync(this.storePath)) {
      fs.mkdirSync(this.storePath);
    }
    const p = path.join(this.storePath, this.botID);
    console.log(`path ${p}`);
    if (!fs.existsSync(p)) {
      fs.mkdirSync(p);
    }
    this.storePath = p;
    const iFile = path.join(p, 'identity.id');
    if (fs.existsSync(iFile)) {
      const content = fs.readFileSync(iFile);
      this.identity = Proteus.keys.IdentityKeyPair.deserialise(util.toArrayBuffer(content));
    } else {
      this.identity = Proteus.keys.IdentityKeyPair.new();
      fs.writeFileSync(iFile, new Buffer(this.identity.serialise()));
    }
  }

  loadPreKeys() {
    const files = fs.readdirSync(this.storePath);
    files.forEach((file) => {
      if (file.endsWith('.pkid')) {
        const pkID = file.replace('.pkid', '');
        this.load_prekey(pkID);
      }
    });
  }

  load_identity() {
    console.log('load_identity');
    return new Promise(resolve =>
      resolve(this.identity));
  }

  save_identity(identity) {
    console.log('save_identity ' + identity);
    return new Promise((resolve) => {
      this.identity = identity;
      return resolve();
    });
  }

  load_session(identity, session_id) {
    console.log('load_session ' + session_id);
    return new Promise((resolve) => {
      try {
        const content = fs.readFileSync(path.join(this.storePath, session_id));
        return resolve(Proteus.session.Session.deserialise(identity, util.toArrayBuffer(content)));
      } catch (err) {
        return resolve(undefined);
      }
    });
  }

  save_session(session_id, session) {
    console.log('save_session ' + session_id + ' ' + session.serialise());
    fs.writeFileSync(path.join(this.storePath, session_id), new Buffer(session.serialise()));
    return new Promise((resolve) => {
      return resolve();
    });
  }

  delete_session(session_id) {
    return new Promise((resolve) => {
      fs.unlinkSync(path.join(this.storePath, session_id));
      return resolve();
    });
  }

  add_prekey(prekey) {
    console.log('add_prekey');
    return new Promise((resolve) => {
      fs.writeFileSync(path.join(this.storePath, `${prekey.key_id}.pkid`), new Buffer(prekey.serialise()));
      return resolve();
    });
  }

  load_prekey(prekey_id) {
    console.log(`load_prekey ${prekey_id}`);
    return new Promise((resolve) => {
      try {
        const content = fs.readFileSync(path.join(this.storePath, `${prekey_id}.pkid`));
        return resolve(Proteus.keys.PreKey.deserialise(util.toArrayBuffer(content)));
      } catch (err) {
        return resolve(undefined);
      }
    });
  }

  delete_prekey(prekey_id) {
    console.log('delete_prekey');
    return new Promise((resolve) => {
      fs.unlinkSync(path.join(this.storePath, `${prekey_id}.pkid`));
      return resolve();
    });
  }
};
