#FROM node:9.3.0-alpine
FROM ubuntu:16.04

# Create app directory
WORKDIR /usr/src/app

RUN apt-get update
RUN apt-get -qq update
RUN apt-get install -y curl
RUN curl -sL https://deb.nodesource.com/setup_8.x | bash -
RUN apt-get install -y nodejs
RUN apt-get install -y build-essential python python3 make gcc g++

RUN apt-get install -y git nano

RUN update-alternatives --install /usr/bin/node node /usr/bin/nodejs 10


COPY package*.json ./

RUN npm install
# If you are building your code for production
# RUN npm install --only=production

# Bundle app source
COPY . .

#EXPOSE 3443
ENTRYPOINT [ "npm", "start" ]
