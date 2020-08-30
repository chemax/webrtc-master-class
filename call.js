JsSIP.debug.enable('JsSIP:*'); //Включаем полный дебаг, хотя он, кажется, включен по дефолту.
const domain = document.domain //Определяем domain имя, которое мы будем использовать для подключения к wss freeswitch.
// У меня всё на одном сервере, вам никто не мешает сделать иначе.

let configuration = { //Конфигурация.
    pcConfig: {
        iceServers: [
            {urls: 'stun:stun.freeswitch.org'}, //Задаем stun, можно любой бесплатный, у гугла их целый выводок
            {//Задаем TURN, вот его лучше иметь свой. Иначе, могут быть проблемы. Никто не будет ваш трафик гонять бесплатно и качественно. Или, хотя бы сколько-нибудь долго.
                urls: 'turn:185.231.155.241',
                credential: "123456",
                username: 'enot1'
            }
        ]
    },
    /*
    * navigator.mediaDevices.getUserMedia() принимает набор mediaConstraints, указывающих, к каким именно устройствам мы хотим получить доступ.
    */
    mediaConstraints: { // https://www.rtcmulticonnection.org/docs/mediaConstraints/
        audio: true, // Принимает только аудио.
        video: false
    }
    ,    rtcOfferConstraints: { // https://jssip.net/documentation/3.4.x/api/session/ как я понял, отвечает за реинвайты
        offerToReceiveAudio: true, // Принимаем только аудио
        offerToReceiveVideo: false
    }
};


function loadPage() {
    console.log('on loadPage');

    $("#loginText").val(localStorage.getItem("login"));
    $("#passwordText").val(localStorage.getItem("pwd"));
    $("#callNumberText").val(localStorage.getItem("callNumber"));

    this._soundsControl = document.getElementById("sounds");
}

function login() {
    console.log("on login");
    this.loginText = $("#loginText");
    this.passwordText = $("#passwordText");
    this.loginButton = $("#loginButton");
    this.logOutButton = $("#logOutButton");
    this.callButton = $('#callNumberButton');
    this.hangUpButton = $('#hangUpButton');

    localStorage.setItem("login", this.loginText.val());
    localStorage.setItem("pwd", this.passwordText.val());

    socket = new JsSIP.WebSocketInterface(`wss://${domain}:7443`);
    _ua = new JsSIP.UA({
        uri: "sip:" + this.loginText.val() + `@${domain}`, //я жёстко прописал домен для логина
        password: this.passwordText.val(),
        display_name: this.loginText.val(),
        session_timers: false,
        sockets: [socket],
    });
    _ua._data = this;

    // соединяемся с freeswitch
    this._ua.on('connecting', () => {
        console.warn("UA connecting");
    });

    // соединились с freeswitch
    this._ua.on('connected', () => {
        console.warn("UA connected");
    });

    // freeswitch нас зарегал, теперь можно звонить и принимать звонки
    this._ua.on('registered', () => {

        console.warn("UA registered");

        this.loginButton.addClass('d-none');
        this.logOutButton.removeClass('d-none');
        this.loginText.prop('disabled', true);
        this.passwordText.prop('disabled', true);

        $("#callPanel").removeClass('d-none');
    });

    // freeswitch про нас больше не знает
    this._ua.on('unregistered', () => {
        console.warn("UA unregistered");
    });

    // freeswitch не зарегал нас, что то не то, скорее всего неверный логин или пароль
    this._ua.on('registrationFailed', (data) => {
        console.error("UA registrationFailed", data.cause);
    });

    // заводим шарманку
    this._ua.start();

    this._ua.on("newRTCSession", function (data) {
        console.log('newRTC Session')
        var session = data.session;

        if (session.direction === "incoming") {
            // incoming call here
            session.on("accepted", function () {
                console.warn('accepted');
                // the call has answered
                $('#callNumberButton').addClass('d-none');
                $('#hangUpButton').removeClass('d-none');
            });
            session.on("confirmed", function (e) {
                console.warn('confirmed');

            });
            session.on("ended", function () {
                console.warn('Call ended')
                // the call has ended
                $('#callNumberButton').removeClass('d-none');
                $('#hangUpButton').addClass('d-none');

            });
            session.on("failed", function () {
                console.error('session failed')
                // unable to establish the call
                $('#callNumberButton').removeClass('d-none');
                $('#hangUpButton').addClass('d-none');
            });

            // Answer call
            session.answer(configuration);
            session.connection.ontrack = function (e) {
                console.log('addstream(track) REMOTE');
                console.dir(e);
                // set remote audio stream (to listen to remote audio)
                // remoteAudioControl is <audio> element on page
                let remoteAudioControl = document.getElementById("remoteAudio");
                remoteAudioControl.srcObject = e.streams[0];
                //remoteAudio.src = window.URL.createObjectURL(e.stream);
                remoteAudioControl.play();
            };

            // Reject call (or hang up it)
            //session.terminate();
            session._ua._data.session = session;
        }
    });

}

function logout() {
    console.log("on logout");

    this.loginButton.removeClass('d-none');
    this.logOutButton.addClass('d-none');
    this.loginText.prop('disabled', false);
    this.passwordText.prop('disabled', false);

    $("#callPanel").addClass('d-none');

    // закрываем всё нафиг, вылогиниваемся из freeswitch, закрываем коннект
    this._ua.stop();
}

function call() {
    let number = $('#callNumberText').val();
    localStorage.setItem("callNumber", number);

    this.callButton.addClass('d-none');
    this.hangUpButton.removeClass('d-none');

    // Делаем ИСХОДЯЩИЙ звонок
    // Принимать звонки этот код не умеет!
    this.session = this._ua.call(number, configuration);

    // Это нужно для входящего звонка, пока не используем
    this._ua.on('newRTCSession', (data) => {
        console.log('newRTCSession incoming')
        if (!this._mounted)
            return;

        if (data.originator === 'local')
            return;

        audioPlayer.play('ringing');
    });

    // freeswitch нас соединил с абонентом
    this.session.on('connecting', () => {
        console.log("UA session connecting");
        playSound("one-day.mp3", true);

        // Тут мы подключаемся к микрофону и цепляем к нему поток, который пойдёт в freeswitch
        let peerconnection = this.session.connection;
        let localStream = peerconnection.getLocalStreams()[0];

        // Handle local stream
        if (localStream) {
            // Clone local stream
            this._localClonedStream = localStream.clone();

            console.log('UA set local stream');

            let localAudioControl = document.getElementById("localAudio");
            localAudioControl.srcObject = this._localClonedStream;
        }
    });

    // В процессе дозвона
    this.session.on('progress', () => {
        console.log("UA session progress");
        playSound("one-day.mp3", true);
    });

    // Дозвон завершился неудачно, например, абонент сбросил звонок
    this.session.on('failed', (data) => {
        console.log("UA session failed");
        stopSound("one-day.mp3");
        playSound("rejected.mp3", false);

        this.callButton.removeClass('d-none');
        this.hangUpButton.addClass('d-none');
    });

    // Поговорили, разбежались
    this.session.on('ended', () => {
        console.log("UA session ended");
        playSound("rejected.mp3", false);
        JsSIP.Utils.closeMediaStream(this._localClonedStream);

        this.callButton.removeClass('d-none');
        this.hangUpButton.addClass('d-none');
    });

    // Звонок принят, моно начинать говорить
    this.session.on('accepted', () => {
        console.log("UA session accepted");
        stopSound("one-day.mp3");
        playSound("answered.mp3", false);
        let remoteAudioControl = document.getElementById("remoteAudio");
        remoteAudioControl.srcObject = this.session.connection.getRemoteStreams()[0];
    });
}

function hangUp() {
    this.session.terminate();
    JsSIP.Utils.closeMediaStream(this._localClonedStream);
}

function playSound(soundName, loop) {
    this._soundsControl.pause();
    this._soundsControl.currentTime = 0.0;
    this._soundsControl.src = "sounds/" + soundName
    this._soundsControl.loop = loop;
    this._soundsControl.play();
}

function stopSound() {
    this._soundsControl.pause();
    this._soundsControl.currentTime = 0.0;
}
