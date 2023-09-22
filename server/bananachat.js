import {WebSocketServer} from 'ws';
import fs from 'fs';
import https from 'https';
const {randomBytes, createHmac} = await import('node:crypto');

const server = https.createServer({
    port:8080,
    cert: fs.readFileSync('/etc/letsencrypt/live/drive.histeria.fr/cert.pem'),
    key: fs.readFileSync('/etc/letsencrypt/live/drive.histeria.fr/privkey.pem')
});
const wss = new WebSocketServer({
    server: server
});
server.listen(8080);
wss.getUniqueID = function () {
    function s4() {
        return Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
    }
    return s4() + s4() + '-' + s4();
};
const salt = "Q5MjaTq-5ps5MjvdLVEhPi4XGFqNsKcXcnmuPNLR-HxtUHGVfpp0_cPSIv7";

//get users from users.json
let users = JSON.parse(fs.readFileSync('users.json', 'utf8'));
let oldSessions = JSON.parse(fs.readFileSync('oldsessions.json', 'utf8'));
let messageHistory = JSON.parse(fs.readFileSync('history.json', 'utf8'));
let sessions = {};

wss.on('connection', client => {
    let id = client.id = wss.getUniqueID();

    try {
        let ip = client._socket.remoteAddress;
        console.log("New connection from "+ip+" with id "+client.id);
        console.log("Total connections: "+wss.clients.size);

        client.on('close', () => {
            console.log("Client disconnected "+ip+" with id "+id);
            delete sessions[id];
        });

        client.on('message', (message) => {
            //Json decode
            let data = '';
            try{
                data = JSON.parse(message);
            } catch (e) {
                console.log("Error parsing JSON from "+ip+" with id "+client.id);
                return;
            }
            console.log(data)

            let username = 'placeholder';
            if (data.type !== "login" && !sessions[id]) {
                //disconnect
                console.log("Unhautorized connection, no token provided from "+ip);
                client.send(JSON.stringify({type: "error", message: "Unhautorized connection, no token provided"}));
                client.close();
                return;
            }

            switch (data.type) {
                case 'login':
                    let token = randomBytes(20).toString('hex');
                    if (data.token) {
                        //Check if token is valid
                        if (oldSessions[data.token]) {
                            username = oldSessions[data.token]?.username ?? 'placeholder';
                            token = data.token;
                        } else {
                            //disconnect
                            console.log("Unhautorized connection, invalid token provided from "+ip);
                            client.send(JSON.stringify({type: "error", message: "Unhautorized connection, invalid token provided"}));
                            client.send(JSON.stringify({type: 'disconnect', success: true}));
                            //client.close();
                            return;
                        }
                    } else {
                        //Hash password
                        let hash = createHmac('sha256', salt).update(data.password).digest('hex');

                        if ((users[data.username] ?? '') !== hash) {
                            console.log("Wrong password from "+ip+" sended hash: "+hash);
                            client.send(JSON.stringify({type: "error", message: "Wrong username or password"}));
                            //client.close();
                            return;
                        }

                        //generate random token
                        username = data.username;
                    }

                    console.log("Adding session for "+username+", client id "+client.id+" with token "+token);
                    sessions[client.id] = {token, client, username, ip};
                    oldSessions[token] = {username, ip, time: Date.now()};
                    client.send(JSON.stringify({type: 'login', success: true, token, username}));
                break;

                case 'message':
                    username = oldSessions[data.token].username;
                    let message = data.message;

                    console.log("Sending the message");

                    Object.values(sessions)
                        .filter(session => session.client !== client)
                        .forEach(session => {
                            console.log("Sending message to "+session.username+" client id "+session.client.id);
                            session.client.send(JSON.stringify({type: 'message', username, message, timestamp: Date.now() / 1000}))
                        });
                    messageHistory.push({username, message, timestamp: Date.now() / 1000});
                break;

                case 'disconnect':
                    //destroy session token
                    delete sessions[client.id];
                    delete oldSessions[data.token];
                    client.send(JSON.stringify({type: 'disconnect', success: true}));
                break;

                case 'history':
                    //send last 100 messages
                    if (messageHistory.length > 100) client.send(JSON.stringify({type: 'history', messages: messageHistory.slice(-100)}));
                    else client.send(JSON.stringify({type: 'history', messages: messageHistory}));
                break;

                case 'list':
                    //send list of users
                    client.send(JSON.stringify({type: 'list', users: Object.values(sessions).map(session => session.username)}));
                break;
            }
        });
    } catch (e) {
        console.log(e);
    }
});

//On exit, save sessions
async function exitHandler(options, exitCode) {
    console.log("Saving sessions, exiting... "+exitCode);
    fs.writeFileSync('oldsessions.json', JSON.stringify(oldSessions));
    fs.writeFileSync('history.json', JSON.stringify(messageHistory));
    process.exit();
    if (options.exit) process.exit();
}

process.on('exit', exitHandler.bind(null,{cleanup:true}));
process.on('SIGINT', exitHandler.bind(null, {exit:true}));//Ctrl+C
process.on('SIGUSR1', exitHandler.bind(null, {exit:true})); //KILL PID
process.on('SIGUSR2', exitHandler.bind(null, {exit:true}));
process.on('uncaughtException', function (exception) {
    console.log(exception)
    exitHandler({exit: true}, exception.message + "\n" + exception.stack).then();
});
