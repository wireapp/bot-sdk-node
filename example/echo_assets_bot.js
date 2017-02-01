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

const path = require('path');

const service = require('../lib/service');

service.createService({
  port: 443,
  key: 'server.key',
  cert: 'server.crt',
  storePath: path.join(__dirname, 'store'),
  auth: '<put your auth token here>',
}, (bot) => {
  console.log(`Bot instance created ${bot.botID}`);
  bot.on('message', (from, message) => {
    console.log(`Got message from ${from} text: ${message.text}`);
    bot.sendMessage(message.text.content, (sendStatus) => {
      console.log(`message successfully sent with status ${sendStatus}`);
    });
  });
  bot.on('image', (from, asset) => {
    console.log(`Got image from ${from} ${JSON.stringify(asset)} `);
    bot.getAsset(asset.asset.uploaded.asset_id,
      asset.asset.uploaded.asset_token,
      asset.asset.uploaded.otr_key,
      asset.asset.uploaded.sha256, (data, status) => {
        console.log(`asset downloaded with status ${status}`);
        if (status === 200) {
          // asset successfully downloaded, echo it back
          const original = asset.asset.original;
          bot.sendImage(data, original.mime_type, original.image, (sendStatus) => {
            console.log(`Image sent with status ${sendStatus}`);
          });
        }
      });
  });
  bot.on('join', (members, conversation) => {
    console.log(`New members ${members} joined conversation ${conversation.id}`);
  });
  bot.on('leave', (members, conversation) => {
    console.log(`Members ${members} have left conversation ${conversation.id}`);
  });
  bot.on('rename', (name, conversation) => {
    console.log(`Conversation ${conversation.id} renamed to ${name}`);
  });
});
