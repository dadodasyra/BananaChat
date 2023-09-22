const ws = new WebSocket('wss://dadodasyra.fr:8081');
//when server crash or updates we need to reconnect
ws.onclose = () => {
    document.querySelector('#error').classList.remove('hidden');
    document.querySelector('#error').innerHTML = "Connection closed, retrying in 3 seconds";
    setTimeout(() => {
        location.reload();
    }, 3000);
}

let token = '';
let username = '';
let lastMessage = {username: '', timestamp: 0};

ws.addEventListener('open', function () { //When connection is established
    console.log("Connected to server");

    let cookies = document.cookie; //Fetch token from cookies
    if (cookies && cookies !== '') token = cookies.split('; ').find(row => row.startsWith('token=')).split('=')[1] ?? null;
    if (token) login(); //If we have a token we try to login with it

    ws.addEventListener('message', ev => { //On server message received
        let data = JSON.parse(ev.data);
        console.log("Message from server: "+ev.data);

        switch (data.type) {
            case 'login':
                if (data.success) {
                    console.log("Login successful");
                    token = data.token;
                    document.cookie = "token="+token+"; expires=Fri, 31 Dec 9999 23:59:59 GMT; path=/";

                    // Hide login page
                    document.querySelector('#login').classList.add('hidden');
                    document.querySelector('#login').classList.remove('flex');
                    // Show chat page
                    document.querySelector('#chat').classList.remove('hidden');
                    document.querySelector('#sendMessage').classList.remove('hidden');
                    document.querySelector('#topbar').classList.remove('hidden');
                    document.querySelector('#username').innerHTML = username = data.username;
                    ws.send(JSON.stringify({"type": "history", token}));
                }
            break;

            case 'message':
                showMessage(data.message, data.username, data.timestamp);
                //Play sound
                document.getElementById("notification").play();
            break;

            case 'history':
                for (let message of data.messages) {
                    if (username === message.username) showMessage(message.message, message.username, message.timestamp, true);
                    else showMessage(message.message, message.username, message.timestamp);
                }
                const chat = document.getElementById("chat");
                chat.scrollTop = chat.scrollHeight;
            break;

            case 'error':
                //Show error popup
                console.error(data.message);
                document.querySelector('#error').classList.remove('hidden');
                document.querySelector('#error').innerHTML = data.message;
            break;

            case 'disconnect':
                //Refresh page and erase token in cookie
                document.cookie = "token="+token+"; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
                location.reload();
            break;

            case 'list':
                //Show list of connected users
                let list = document.querySelector('.list');
                list.classList.remove('hidden');
                let innerHTML = '<strong>Personnes connectées</strong> ' +
                    '<ul>';
                for (let user of data.users) {
                    innerHTML += `<li class="online">${user}</li>`;
                }
                innerHTML += '</ul>';
                list.innerHTML = innerHTML;

                setTimeout(() => {
                    list.classList.add('hidden');
                }, 5000);
            break;
        }
    });

    document.querySelector('#login').onsubmit = ev => {
        ev.preventDefault();

        console.log("Sending login with password");
        login();
    }

    document.querySelector('#sendMessage').onsubmit = ev => {
        ev.preventDefault();

        const input = document.querySelector('#chatInput');
        if (!input.value) return; //Can't send an empty message //FUTURE: Show error message

        ws.send(JSON.stringify({"type": "message", "message": input.value, token}));
        showMessage(input.value, username, (Date.now() / 1000), true);
        input.value = ''; //Clear input
    }
});

function login()
{
    console.log("Asking login to server");
    // Get username and password
    let username = document.querySelector('.username').value;
    let password = document.querySelector('.password').value;

    // Send login request
    if (token) { //The token already exist, we just need to reverify it
        ws.send(JSON.stringify({
            type: 'login',
            token
        }));
    } else {
        ws.send(JSON.stringify({
            type: 'login',
            username: username,
            password: password //TODO hash password
        }));
    }
}

function showMessage(text, username, timestamp, isMine = false)
{
    const chat = document.getElementById("chat");
    //Save scroll position
    const oldTotalScrollHeight = chat.scrollHeight;

    //Format timestamp which is actually in seconds since 1970
    let date = new Date(timestamp * 1000);
    let formattedTime = '';

    //If the message is from today we only show the hour
    if (date.toLocaleDateString() === new Date().toLocaleDateString()) {
        formattedTime = date.toLocaleTimeString();
    } else {
        //Show date and hour
        formattedTime = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }


    //If the last message was from the same user and less than 60 seconds ago
    let isGroupping = lastMessage.username === username && lastMessage.timestamp + 300 > timestamp;

    //Avoid XSS & HTML injection by parsing the message as HTML
    text = text.replace(/<\/?[^>]+(>|$)/g, "");
    //Replace link with <a> tag
    text = text.replace(/(https?:\/\/[^\s]+)/g, '<a class="link" href="$1" target="_blank">$1</a>');
    if (!text) return; //Can't show an empty message, it happens if HTML is injected and the message doesnt contain anything else

    // Show message on client page
    const messageRow = `
        <div class="message-row ${isMine ? 'mine' : 'theirs'}">
            ${isGroupping ? '' : `
                <div class="details">
                    ${isMine ? `
                        <div class="message-timestamp">${formattedTime}</div>
                        <div class="sender">${username}</div>
                    ` : `
                        <div class="sender">${username}</div>
                        <div class="message-timestamp">${formattedTime}</div>
                    `}
                </div>
            `}
            <div class="bubble">${text}</div>
        </div>
    `;

    // Use the messageRow variable in the innerHTML property
    document.getElementById("messages").innerHTML += messageRow;
    lastMessage = {username, timestamp};

    //Scrolls down to the last message unless if the user scrolled up
    //scrollTop = distance between top and scroll level
    //clientHeight = size of the window
    //50 pixels de marge
    if ((chat.scrollTop + chat.clientHeight + 50) >= oldTotalScrollHeight) chat.scrollTop = chat.scrollHeight;

    //if the user is not on the page we change the favicon
    if (!document.hasFocus()) {
        document.querySelector("link[rel~='icon']").href = "/media/icon_notif.png";

        window.addEventListener("focus", function(){
            document.querySelector("link[rel~='icon']").href = "/media/icon.png";
        }, { once: true });
    }
}

function topbarDisconnect() {
    ws.send(JSON.stringify({"type": "disconnect", token}));
}

function topbarList() {
    ws.send(JSON.stringify({"type": "list", token}));
}

function muteAudio() {
    let audio = document.getElementById("notification");
    audio.muted = !audio.muted;
    if (audio.muted) {
        document.getElementById("mute").classList.add("hidden");
        document.getElementById("unmute").classList.remove("hidden");
    } else {
        document.getElementById("mute").classList.remove("hidden");
        document.getElementById("unmute").classList.add("hidden");
    }
}

//Show password
let showBtn = document.querySelector(".show-password");

showBtn.addEventListener("click", function(){
    let password = document.querySelector(".password");
    if(password.type === "password") {
        password.type = "text";
    } else {
        password.type = "password";
    }
});