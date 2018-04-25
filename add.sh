#!/bin/sh

read -p "email: " email
echo 'password:'
read -s password

curl -s -XPOST "https://prod-nginz-https.wire.com/login" \
    -H 'Content-Type: application/json' \
    -d '{"email":"'${email}'"
        ,"password":"'${password}'"}' \
    | jq -r ".access_token" > .token

token=$(cat .token)

curl -s -XPOST "https://prod-nginz-https.wire.com/conversations" \
    -H 'Content-Type: application/json' \
    -H 'Authorization:Bearer '${token}'' \
    -d '{"users": [], "name":"Wire Bots"}' \
    | jq -r '.id' > .conv

read -p "serviceId: " service
read -p "providerId: " provider

conv=$(cat .conv)
curl -i -XPOST 'https://prod-nginz-https.wire.com/conversations/'${conv}'/bots' \
    -H 'Content-Type: application/json' \
    -H 'Authorization:Bearer '${token}'' \
    -d '{"service": "'${service}'", "provider": "'${provider}'"}'
