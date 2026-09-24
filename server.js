<!DOCTYPE html>
<html lang="om">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#0b7a53">
  <title>Waliin-GM</title>

  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: Arial, sans-serif;
      background: #f3f7f5;
      color: #17221d;
      min-height: 100vh;
    }

    button,
    input {
      font: inherit;
    }

    button {
      cursor: pointer;
      border: none;
    }

    .hidden {
      display: none !important;
    }

    .page {
      min-height: 100vh;
      padding-bottom: 75px;
    }

    /* AUTH */

    #authPage {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: linear-gradient(145deg, #075b3d, #0b8b60);
    }

    .auth-box {
      width: 100%;
      max-width: 420px;
      background: white;
      border-radius: 24px;
      padding: 28px 22px;
      box-shadow: 0 15px 40px rgba(0,0,0,.2);
    }

    .logo {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: #0b7a53;
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      font-weight: bold;
      margin: 0 auto 15px;
    }

    .auth-box h1 {
      text-align: center;
      color: #075b3d;
      margin-bottom: 6px;
    }

    .auth-box p {
      text-align: center;
      color: #68736e;
      margin-bottom: 22px;
    }

    .field {
      margin-bottom: 13px;
    }

    .field label {
      display: block;
      font-size: 14px;
      margin-bottom: 6px;
      font-weight: bold;
    }

    .field input {
      width: 100%;
      padding: 13px;
      border: 1px solid #d5ddd9;
      border-radius: 12px;
      outline: none;
    }

    .field input:focus {
      border-color: #0b7a53;
    }

    .main-btn {
      width: 100%;
      padding: 14px;
      border-radius: 13px;
      background: #0b7a53;
      color: white;
      font-weight: bold;
      margin-top: 5px;
    }

    .secondary-btn {
      width: 100%;
      padding: 13px;
      border-radius: 13px;
      background: #e8f1ed;
      color: #075b3d;
      font-weight: bold;
      margin-top: 10px;
    }

    .auth-message {
      margin-top: 12px;
      text-align: center;
      font-size: 14px;
    }

    /* HEADER */

    .topbar {
      position: sticky;
      top: 0;
      z-index: 50;
      background: white;
      padding: 14px 16px;
      border-bottom: 1px solid #e1e8e4;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .brand {
      font-size: 22px;
      font-weight: bold;
      color: #075b3d;
    }

    .online {
      font-size: 12px;
      color: #0b7a53;
      font-weight: bold;
    }

    /* HOME */

    .content {
      padding: 18px 15px;
      max-width: 900px;
      margin: auto;
    }

    .welcome {
      background: linear-gradient(135deg, #075b3d, #0b8b60);
      color: white;
      border-radius: 20px;
      padding: 22px;
      margin-bottom: 18px;
    }

    .welcome h2 {
      margin-bottom: 6px;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }

    .feature {
      background: white;
      border-radius: 17px;
      padding: 18px 12px;
      min-height: 115px;
      box-shadow: 0 2px 9px rgba(0,0,0,.05);
      text-align: center;
    }

    .feature .icon {
      font-size: 30px;
      margin-bottom: 8px;
    }

    .feature strong {
      display: block;
      margin-bottom: 4px;
    }

    .feature small {
      color: #75807b;
    }

    /* CLUB */

    .club-box {
      background: white;
      border-radius: 20px;
      padding: 18px;
      margin-top: 18px;
    }

    .club-box h3 {
      margin-bottom: 12px;
      color: #075b3d;
    }

    .club-input {
      width: 100%;
      padding: 13px;
      border: 1px solid #d5ddd9;
      border-radius: 12px;
      margin-bottom: 10px;
    }

    .room-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .action-btn {
      padding: 13px 8px;
      border-radius: 12px;
      background: #0b7a53;
      color: white;
      font-weight: bold;
    }

    .action-btn.gray {
      background: #e8f1ed;
      color: #075b3d;
    }

    /* ROOM */

    #roomPage {
      background: #07140f;
      color: white;
      min-height: 100vh;
      padding-bottom: 20px;
    }

    .room-header {
      padding: 14px;
      background: #0b2118;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 30;
    }

    .room-title {
      font-weight: bold;
    }

    .room-id {
      font-size: 11px;
      color: #9fb7aa;
      margin-top: 3px;
    }

    .leave-room {
      background: #d83a3a;
      color: white;
      padding: 9px 13px;
      border-radius: 10px;
      font-weight: bold;
    }

    .room-body {
      max-width: 1000px;
      margin: auto;
      padding: 14px;
    }

    .room-info {
      background: #10291f;
      border-radius: 16px;
      padding: 13px;
      margin-bottom: 14px;
    }

    .speaker-title {
      margin: 12px 0 9px;
      font-weight: bold;
    }

    .seats {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 9px;
    }

    .seat {
      min-height: 86px;
      background: #10291f;
      border: 1px solid #214637;
      border-radius: 15px;
      padding: 8px 4px;
      text-align: center;
      position: relative;
    }

    .seat-number {
      position: absolute;
      top: 5px;
      left: 6px;
      font-size: 9px;
      color: #7f9a8e;
    }

    .avatar {
      width: 37px;
      height: 37px;
      border-radius: 50%;
      background: #0b7a53;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 8px auto 5px;
      font-weight: bold;
    }

    .seat-name {
      font-size: 10px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .mic-state {
      font-size: 10px;
      margin-top: 3px;
    }

    .empty-seat {
      color: #668276;
      padding-top: 30px;
      font-size: 11px;
    }

    .room-controls {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin: 15px 0;
    }

    .room-control {
      padding: 11px 5px;
      border-radius: 12px;
      background: #17382a;
      color: white;
      font-size: 12px;
    }

    .room-control.active {
      background: #0b7a53;
    }

    .room-control.danger {
      background: #7d2525;
    }

    .gift-row {
      display: flex;
      gap: 7px;
      overflow-x: auto;
      padding-bottom: 4px;
    }

    .gift {
      min-width: 58px;
      padding: 9px 5px;
      border-radius: 12px;
      background: #17382a;
      color: white;
    }

    .gift span {
      display: block;
      font-size: 22px;
    }

    .gift small {
      font-size: 9px;
    }

    .room-panels {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-top: 15px;
    }

    .panel {
      background: #10291f;
      border-radius: 15px;
      padding: 13px;
    }

    .panel h4 {
      margin-bottom: 10px;
    }

    .member-item,
    .request-item {
      background: #17382a;
      padding: 9px;
      border-radius: 9px;
      margin-bottom: 6px;
      font-size: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 5px;
    }

    .small-btn {
      padding: 6px 8px;
      border-radius: 7px;
      background: #0b7a53;
      color: white;
      font-size: 10px;
    }

    .small-btn.red {
      background: #8d2929;
    }

    /* CHAT */

    .chat {
      margin-top: 14px;
      background: #10291f;
      border-radius: 15px;
      padding: 12px;
    }

    #chatMessages {
      height: 170px;
      overflow-y: auto;
      margin-bottom: 9px;
    }

    .message {
      margin-bottom: 7px;
      font-size: 12px;
    }

    .message b {
      color: #62d5a5;
    }

    .chat-form {
      display: flex;
      gap: 7px;
    }

    .chat-form input {
      flex: 1;
      padding: 11px;
      border-radius: 10px;
      border: none;
      outline: none;
    }

    .chat-form button {
      padding: 11px 15px;
      border-radius: 10px;
      background: #0b7a53;
      color: white;
    }

    /* BOTTOM NAV */

    .bottom-nav {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 100;
      height: 65px;
      background: white;
      border-top: 1px solid #dce5e0;
      display: grid;
      grid-template-columns: repeat(5, 1fr);
    }

    .nav-btn {
      background: white;
      color: #718079;
      font-size: 10px;
    }

    .nav-btn .nav-icon {
      display: block;
      font-size: 20px;
      margin-bottom: 3px;
    }

    .nav-btn.active {
      color: #0b7a53;
      font-weight: bold;
    }

    /* MODAL */

    .modal {
      position: fixed;
      inset: 0;
      z-index: 200;
      background: rgba(0,0,0,.65);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 18px;
    }

    .modal-box {
      width: 100%;
      max-width: 420px;
      background: white;
      color: #17221d;
      border-radius: 20px;
      padding: 20px;
    }

    .modal-box h3 {
      color: #075b3d;
      margin-bottom: 14px;
    }

    .modal-box button {
      width: 100%;
      padding: 12px;
      border-radius: 11px;
      margin-top: 8px;
      background: #0b7a53;
      color: white;
    }

    .modal-box .close {
      background: #e8f1ed;
      color: #075b3d;
    }

    @media (max-width: 600px) {
      .seats {
        grid-template-columns: repeat(5, 1fr);
      }

      .room-panels {
        grid-template-columns: 1fr;
      }

      .room-controls {
        grid-template-columns: repeat(4, 1fr);
      }
    }
  </style>
</head>

<body>

  <!-- AUTH PAGE -->

  <section id="authPage">

    <div class="auth-box">

      <div class="logo">W</div>

      <h1>Waliin-GM</h1>

      <p>Chat • Voice • Club • Room</p>

      <div id="loginForm">

        <div class="field">
          <label>Email</label>
          <input
            id="loginEmail"
            type="email"
            placeholder="Email kee"
          >
        </div>

        <div class="field">
          <label>Password</label>
          <input
            id="loginPassword"
            type="password"
            placeholder="Password kee"
          >
        </div>

        <button
          class="main-btn"
          onclick="login()"
        >
          Seeni
        </button>

        <button
          class="secondary-btn"
          onclick="showRegister()"
        >
          Account Haaraa Uumi
        </button>

      </div>

      <div id="registerForm" class="hidden">

        <div class="field">
          <label>Username</label>
          <input
            id="regUsername"
            type="text"
            placeholder="Maqaa fayyadamaa"
          >
        </div>

        <div class="field">
          <label>Email</label>
          <input
            id="regEmail"
            type="email"
            placeholder="Email"
          >
        </div>

        <div class="field">
          <label>Password</label>
          <input
            id="regPassword"
            type="password"
            placeholder="Password (6+)"
          >
        </div>

        <button
          class="main-btn"
          onclick="register()"
        >
          Account Uumi
        </button>

        <button
          class="secondary-btn"
          onclick="showLogin()"
        >
          Gara Login
        </button>

      </div>

      <div
        id="authMessage"
        class="auth-message"
      ></div>

    </div>

  </section>


  <!-- HOME PAGE -->

  <section id="homePage" class="page hidden">

    <header class="topbar">

      <div class="brand">
        Waliin-GM
      </div>

      <div
        id="connectionStatus"
        class="online"
      >
        ● Online
      </div>

    </header>

    <main class="content">

      <div class="welcome">

        <h2>
          Baga nagaan dhuftan 👋
        </h2>

        <div id="welcomeUser">
          Waliin-GM
        </div>

      </div>


      <div class="grid">

        <button
          class="feature"
          onclick="openCreateClub()"
        >
          <div class="icon">🎙️</div>
          <strong>Voice Room</strong>
          <small>Room uumi</small>
        </button>

        <button
          class="feature"
          onclick="openJoinClub()"
        >
          <div class="icon">🚪</div>
          <strong>Join Room</strong>
          <small>Room seeni</small>
        </button>

        <button
          class="feature"
          onclick="showComing('Chat')"
        >
          <div class="icon">💬</div>
          <strong>Chat</strong>
          <small>Ergaa ergi</small>
        </button>

        <button
          class="feature"
          onclick="showComing('Video Room')"
        >
          <div class="icon">🎥</div>
          <strong>Video</strong>
          <small>Video room</small>
        </button>

        <button
          class="feature"
          onclick="showComing('Call')"
        >
          <div class="icon">📞</div>
          <strong>Call</strong>
          <small>Bilbila</small>
        </button>

        <button
          class="feature"
          onclick="showComing('Club')"
        >
          <div class="icon">👥</div>
          <strong>Club</strong>
          <small>Club ilaali</small>
        </button>

        <button
          class="feature"
          onclick="showComing('Search')"
        >
          <div class="icon">🔎</div>
          <strong>Search</strong>
          <small>Barbaadi</small>
        </button>

        <button
          class="feature"
          onclick="openSettings()"
        >
          <div class="icon">⚙️</div>
          <strong>Settings</strong>
          <small>Qindaa'ina</small>
        </button>

      </div>


      <div class="club-box">

        <h3>
          🎙️ Voice Club
        </h3>

        <input
          id="clubName"
          class="club-input"
          placeholder="Maqaa Club"
        >

        <div class="room-actions">

          <button
            class="action-btn"
            onclick="createClub()"
          >
            ➕ Create Club
          </button>

          <button
            class="action-btn gray"
            onclick="openJoinClub()"
          >
            🔗 Join Club
          </button>

        </div>

      </div>

    </main>

    <nav class="bottom-nav">

      <button
        class="nav-btn active"
        onclick="goHome()"
      >
        <span class="nav-icon">🏠</span>
        Home
      </button>

      <button
        class="nav-btn"
        onclick="showComing('Chat')"
      >
        <span class="nav-icon">💬</span>
        Chat
      </button>

      <button
        class="nav-btn"
        onclick="showComing('Club')"
      >
        <span class="nav-icon">👥</span>
        Club
      </button>

      <button
        class="nav-btn"
        onclick="showComing('Notifications')"
      >
        <span class="nav-icon">🔔</span>
        Notify
      </button>

      <button
        class="nav-btn"
        onclick="openSettings()"
      >
        <span class="nav-icon">⚙️</span>
        Settings
      </button>

    </nav>

  </section>


  <!-- ROOM PAGE -->

  <section
    id="roomPage"
    class="hidden"
  >

    <header class="room-header">

      <div>

        <div
          id="roomName"
          class="room-title"
        >
          Waliin-GM Club
        </div>

        <div
          id="roomId"
          class="room-id"
        >
          ID: -
        </div>

      </div>

      <button
        class="leave-room"
        onclick="leaveRoom()"
      >
        Ba'i 🚪
      </button>

    </header>


    <main class="room-body">

      <div class="room-info">

        👥 Members:
        <b id="memberCount">0</b>

        &nbsp;&nbsp;

        🎧 Listeners:
        <b id="listenerCount">0</b>

      </div>


      <div class="speaker-title">
        🎤 Speakers — 15 Seats
      </div>

      <div
        id="seats"
        class="seats"
      ></div>


      <div class="room-controls">

        <button
          id="micButton"
          class="room-control"
          onclick="toggleMic()"
        >
          🎤 Mic ON
        </button>

        <button
          class="room-control"
          onclick="requestSeat()"
        >
          🙋 Seat
        </button>

        <button
          class="room-control"
          onclick="leaveSeat()"
        >
          🪑 Leave Seat
        </button>

        <button
          class="room-control"
          onclick="shareRoom()"
        >
          🔗 Share
        </button>

      </div>


      <div class="panel">

        <h4>🎁 Gifts</h4>

        <div class="gift-row">

          <button
            class="gift"
            onclick="sendGift('❤️')"
          >
            <span>❤️</span>
            <small>Heart</small>
          </button>

          <button
            class="gift"
            onclick="sendGift('🌹')"
          >
            <span>🌹</span>
            <small>Rose</small>
          </button>

          <button
            class="gift"
            onclick="sendGift('🎁')"
          >
            <span>🎁</span>
            <small>Gift</small>
          </button>

          <button
            class="gift"
            onclick="sendGift('⭐')"
          >
            <span>⭐</span>
            <small>Star</small>
          </button>

          <button
            class="gift"
            onclick="sendGift('👑')"
          >
            <span>👑</span>
            <small>Crown</small>
          </button>

        </div>

      </div>


      <div class="room-panels">

        <div class="panel">

          <h4>👥 Members</h4>

          <div id="membersList"></div>

        </div>


        <div
          id="ownerPanel"
          class="panel hidden"
        >

          <h4>👑 Owner Control</h4>

          <div id="requestsList"></div>

        </div>

      </div>


      <div class="chat">

        <h4>💬 Room Chat</h4>

        <div id="chatMessages"></div>

        <div class="chat-form">

          <input
            id="chatInput"
            placeholder="Ergaa barreessi..."
            onkeydown="if(event.key==='Enter') sendChat()"
          >

          <button
            onclick="sendChat()"
          >
            Ergi
          </button>

        </div>

      </div>

    </main>

  </section>


  <!-- MODAL -->

  <div
    id="modal"
    class="modal hidden"
  >

    <div class="modal-box">

      <h3 id="modalTitle">
        Waliin-GM
      </h3>

      <div id="modalContent"></div>

      <button
        class="close"
        onclick="closeModal()"
      >
        Cufi
      </button>

    </div>

  </div>


  <!-- REMOTE AUDIO -->

  <div
    id="audioContainer"
    class="hidden"
  ></div>


  <script src="/socket.io/socket.io.js"></script>

  <script>
    /* =========================================
       GLOBAL VARIABLES
    ========================================= */

    let socket = null;

    let currentUser = null;

    let currentClub = null;

    let localStream = null;

    let micEnabled = true;

    const peers = new Map();

    const remoteAudios = new Map();

    let pendingCandidates = new Map();


    /* =========================================
       DOM HELPERS
    ========================================= */

    function $(id) {
      return document.getElementById(id);
    }


    function showMessage(text, good = false) {

      $("authMessage").textContent = text;

      $("authMessage").style.color =
        good ? "#0b7a53" : "#c22e2e";
    }


    function showLogin() {

      $("loginForm").classList.remove("hidden");

      $("registerForm").classList.add("hidden");

      showMessage("");
    }


    function showRegister() {

      $("loginForm").classList.add("hidden");

      $("registerForm").classList.remove("hidden");

      showMessage("");
    }


    /* =========================================
       REGISTER
    ========================================= */

    async function register() {

      const username =
        $("regUsername").value.trim();

      const email =
        $("regEmail").value.trim();

      const password =
        $("regPassword").value;

      if (!username || !email || !password) {

        showMessage(
          "Username, email fi password guuti."
        );

        return;
      }

      try {

        const response =
          await fetch("/api/register", {

            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body: JSON.stringify({
              username,
              email,
              password
            })
          });

        const data =
          await response.json();

        if (!data.success) {

          showMessage(
            data.message ||
            "Register hin milkoofne."
          );

          return;
        }

        showMessage(
          "Account uumame. Amma seeni.",
          true
        );

        $("loginEmail").value = email;

        $("loginPassword").value = "";

        showLogin();

      } catch (error) {

        showMessage(
          "Server waliin wal qunnamtiin hin jiru."
        );
      }
    }


    /* =========================================
       LOGIN
    ========================================= */

    async function login() {

      const email =
        $("loginEmail").value.trim();

      const password =
        $("loginPassword").value;

      if (!email || !password) {

        showMessage(
          "Email fi password guuti."
        );

        return;
      }

      try {

        const response =
          await fetch("/api/login", {

            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body: JSON.stringify({
              email,
              password
            })
          });

        const data =
          await response.json();

        if (!data.success) {

          showMessage(
            data.message ||
            "Login hin milkoofne."
          );

          return;
        }

        currentUser = data.user;

        localStorage.setItem(
          "waliin_gm_user",
          JSON.stringify(data.user)
        );

        connectSocket();

        showHome();

      } catch (error) {

        showMessage(
          "Server waliin wal qunnamtiin hin jiru."
        );
      }
    }


    /* =========================================
       SOCKET
    ========================================= */

    function connectSocket() {

      if (socket) {

        try {
          socket.disconnect();
        } catch (e) {}

      }

      socket = io();

      socket.on("connect", () => {

        $("connectionStatus").textContent =
          "● Online";

        $("connectionStatus").style.color =
          "#0b7a53";
      });


      socket.on("disconnect", () => {

        $("connectionStatus").textContent =
          "● Offline";

        $("connectionStatus").style.color =
          "#c22e2e";
      });


      /* CLUB UPDATE */

      socket.on(
        "clubUpdate",
        async (club) => {

          currentClub = club;

          if (
            !$("roomPage").classList.contains("hidden")
          ) {

            renderClub();

            await syncVoiceConnections();
          }
        }
      );


      /* SEAT REQUEST */

      socket.on(
        "seatRequest",
        (data) => {

          if (
            currentClub &&
            currentUser.username ===
              currentClub.owner
          ) {

            renderClub();
          }
        }
      );


      /* SEAT GRANTED */

      socket.on(
        "seatGranted",
        async (data) => {

          if (
            data.username ===
            currentUser.username
          ) {

            await startMicrophone();

            alert(
              "🎤 Seat siif kennameera!"
            );
          }

          await syncVoiceConnections();
        }
      );


      /* MUTE */

      socket.on(
        "memberMute",
        (data) => {

          const audio =
            remoteAudios.get(
              getUsernameBySocket(data.username)
            );

          if (audio) {
            audio.muted = data.muted;
          }

          renderClub();
        }
      );


      /* REMOVED */

      socket.on(
        "removedFromClub",
        () => {

          closeRoom();

          alert(
            "🚫 Ati room kana keessaa haqamte."
          );
        }
      );


      /* CHAT */

      socket.on(
        "chatMessage",
        (item) => {

          addChatMessage(item);
        }
      );


      /* GIFT */

      socket.on(
        "giftReceived",
        (item) => {

          addGiftMessage(item);
        }
      );


      /* WEBRTC OFFER */

      socket.on(
        "webrtc-offer",
        async ({ from, offer }) => {

          try {

            const peer =
              await getOrCreatePeer(
                from,
                false
              );

            await peer.setRemoteDescription(
              new RTCSessionDescription(offer)
            );

            await flushCandidates(from);

            const answer =
              await peer.createAnswer();

            await peer.setLocalDescription(
              answer
            );

            socket.emit(
              "webrtc-answer",
              {
                target: from,
                answer: peer.localDescription
              }
            );

          } catch (error) {

            console.error(
              "Offer error:",
              error
            );
          }
        }
      );


      /* WEBRTC ANSWER */

      socket.on(
        "webrtc-answer",
        async ({ from, answer }) => {

          try {

            const peer =
              peers.get(from);

            if (!peer) return;

            await peer.setRemoteDescription(
              new RTCSessionDescription(answer)
            );

            await flushCandidates(from);

          } catch (error) {

            console.error(
              "Answer error:",
              error
            );
          }
        }
      );


      /* ICE */

      socket.on(
        "webrtc-ice",
        async ({ from, candidate }) => {

          if (!candidate) return;

          const peer =
            peers.get(from);

          if (
            peer &&
            peer.remoteDescription
          ) {

            try {

              await peer.addIceCandidate(
                new RTCIceCandidate(candidate)
              );

            } catch (error) {

              console.error(
                "ICE error:",
                error
              );
            }

          } else {

            if (!pendingCandidates.has(from)) {
              pendingCandidates.set(from, []);
            }

            pendingCandidates
              .get(from)
              .push(candidate);
          }
        }
      );
    }


    /* =========================================
       HOME
    ========================================= */

    function showHome() {

      $("authPage").classList.add("hidden");

      $("homePage").classList.remove("hidden");

      $("roomPage").classList.add("hidden");

      $("welcomeUser").textContent =
        currentUser
          ? currentUser.username
          : "Waliin-GM";
    }


    function goHome() {

      if (
        !$("roomPage").classList.contains("hidden")
      ) {

        closeRoom();
      }

      showHome();
    }


    /* =========================================
       CREATE CLUB
    ========================================= */

    function openCreateClub() {

      $("clubName").focus();

      window.scrollTo({
        top: document.body.scrollHeight,
        behavior: "smooth"
      });
    }


    function createClub() {

      if (!socket) {

        alert("Socket hin qindaa'in.");

        return;
      }

      const name =
        $("clubName").value.trim() ||
        "Waliin-GM Club";

      socket.emit(
        "createClub",
        {
          name,
          username: currentUser.username
        },
        (response) => {

          if (!response || !response.success) {

            alert(
              response?.message ||
              "Club uumuu hin dandeenye."
            );

            return;
          }

          currentClub = response.club;

          openRoom();
        }
      );
    }


    /* =========================================
       JOIN CLUB
    ========================================= */

    function openJoinClub() {

      openModal(
        "🔗 Join Club",
        `
          <input
            id="joinClubId"
            class="club-input"
            placeholder="Club ID galchi"
          >

          <button onclick="joinClub()">
            Seeni
          </button>
        `
      );
    }


    function joinClub() {

      const clubId =
        $("joinClubId").value.trim();

      if (!clubId) {

        alert("Club ID galchi.");

        return;
      }

      socket.emit(
        "joinClub",
        {
          clubId,
          username: currentUser.username
        },
        (response) => {

          if (!response || !response.success) {

            alert(
              response?.message ||
              "Club seenuu hin dandeenye."
            );

            return;
          }

          currentClub = response.club;

          closeModal();

          openRoom();
        }
      );
    }


    /* =========================================
       OPEN ROOM
    ========================================= */

    function openRoom() {

      $("homePage").classList.add("hidden");

      $("roomPage").classList.remove("hidden");

      renderClub();

      startMicrophone();

      syncVoiceConnections();
    }


    /* =========================================
       RENDER CLUB
    ========================================= */

    function renderClub() {

      if (!currentClub) return;

      $("roomName").textContent =
        currentClub.name;

      $("roomId").textContent =
        "ID: " + currentClub.id;

      $("memberCount").textContent =
        currentClub.members.length;

      $("listenerCount").textContent =
        currentClub.listenerCount;


      /* SEATS */

      const seats =
        $("seats");

      seats.innerHTML = "";

      for (
        let i = 0;
        i < 15;
        i++
      ) {

        const username =
          currentClub.seats[i];

        const div =
          document.createElement("div");

        div.className = "seat";

        if (username) {

          const member =
            currentClub.members.find(
              m => m.username === username
            );

          const muted =
            member?.muted || false;

          const owner =
            username === currentClub.owner;

          div.innerHTML = `
            <div class="seat-number">
              ${i + 1}
            </div>

            <div class="avatar">
              ${escapeHtml(
                username
                  .charAt(0)
                  .toUpperCase()
              )}
            </div>

            <div class="seat-name">
              ${escapeHtml(username)}
              ${owner ? " 👑" : ""}
            </div>

            <div class="mic-state">
              ${muted ? "🔇" : "🎤"}
            </div>
          `;

        } else {

          div.innerHTML = `
            <div class="seat-number">
              ${i + 1}
            </div>

            <div class="empty-seat">
              🪑<br>
              Empty
            </div>
          `;
        }

        seats.appendChild(div);
      }


      /* MEMBERS */

      const membersList =
        $("membersList");

      membersList.innerHTML = "";

      currentClub.members.forEach(
        member => {

          const item =
            document.createElement("div");

          item.className =
            "member-item";

          const isOwner =
            currentUser.username ===
            currentClub.owner;

          let controls = "";

          if (
            isOwner &&
            member.username !==
              currentClub.owner
          ) {

            controls = `
              <button
                class="small-btn"
                onclick="ownerMute('${encodeURIComponent(member.username)}')"
              >
                🔇
              </button>

              <button
                class="small-btn red"
                onclick="removeMember('${encodeURIComponent(member.username)}')"
              >
                🚫
              </button>
            `;
          }

          item.innerHTML = `
            <span>
              ${member.username}
              ${member.username === currentClub.owner ? " 👑" : ""}
              ${member.seat !== null ? " 🎤" : " 🎧"}
            </span>

            <span>
              ${controls}
            </span>
          `;

          membersList.appendChild(item);
        }
      );


      /* OWNER PANEL */

      if (
        currentUser.username ===
        currentClub.owner
      ) {

        $("ownerPanel")
          .classList.remove("hidden");

        renderRequests();

      } else {

        $("ownerPanel")
          .classList.add("hidden");
      }
    }


    /* =========================================
       REQUESTS
    ========================================= */

    function renderRequests() {

      const box =
        $("requestsList");

      box.innerHTML = "";

      if (
        !currentClub.requests ||
        currentClub.requests.length === 0
      ) {

        box.innerHTML =
          `<div style="font-size:12px;color:#9fb7aa">
             Request hin jiru.
           </div>`;

        return;
      }

      currentClub.requests.forEach(
        username => {

          const row =
            document.createElement("div");

          row.className =
            "request-item";

          row.innerHTML = `
            <span>🙋 ${escapeHtml(username)}</span>

            <button
              class="small-btn"
              onclick="grantSeat('${encodeURIComponent(username)}')"
            >
              🎤 Seat kenni
            </button>
          `;

          box.appendChild(row);
        }
      );
    }


    /* =========================================
       REQUEST SEAT
    ========================================= */

    function requestSeat() {

      if (!socket || !currentClub) return;

      socket.emit("requestSeat");

      alert(
        "🙋 Request kee Owner bira gaheera."
      );
    }


    /* =========================================
       GRANT SEAT
    ========================================= */

    function grantSeat(username) {

      username =
        decodeURIComponent(username);

      if (!currentClub) return;

      const freeSeat =
        currentClub.seats.findIndex(
          seat => !seat
        );

      if (freeSeat === -1) {

        alert(
          "🪑 Seats 15 guutamaniiru."
        );

        return;
      }

      socket.emit(
        "giveSeat",
        {
          username,
          seat: freeSeat
        }
      );
    }


    /* =========================================
       LEAVE SEAT
    ========================================= */

    function leaveSeat() {

      if (!socket) return;

      socket.emit("leaveSeat");

      stopMicrophone();
    }


    /* =========================================
       MICROPHONE
    ========================================= */

    async function startMicrophone() {

      if (localStream) {

        localStream
          .getAudioTracks()
          .forEach(
            track => {
              track.enabled =
                micEnabled;
            }
          );

        return true;
      }

      try {

        localStream =
          await navigator.mediaDevices
            .getUserMedia({
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
              },
              video: false
            });

        localStream
          .getAudioTracks()
          .forEach(
            track => {
              track.enabled =
                micEnabled;
            }
          );

        await updatePeerTracks();

        updateMicButton();

        return true;

      } catch (error) {

        console.error(
          "Microphone error:",
          error
        );

        alert(
          "🎤 Microphone eeyyama gaafata. Browser irratti Allow jedhu filadhu."
        );

        return false;
      }
    }


    function stopMicrophone() {

      if (!localStream) return;

      localStream
        .getTracks()
        .forEach(
          track => track.stop()
        );

      localStream = null;

      peers.forEach(
        peer => {

          peer.getSenders()
            .forEach(sender => {

              if (
                sender.track &&
                sender.track.kind ===
                  "audio"
              ) {

                try {
                  peer.removeTrack(sender);
                } catch (e) {}
              }
            });
        }
      );
    }


    async function toggleMic() {

      if (!localStream) {

        const started =
          await startMicrophone();

        if (!started) return;
      }

      micEnabled =
        !micEnabled;

      localStream
        .getAudioTracks()
        .forEach(
          track => {
            track.enabled =
              micEnabled;
          }
        );

      socket.emit(
        "muteSelf",
        {
          muted: !micEnabled
        }
      );

      updateMicButton();
    }


    function updateMicButton() {

      const button =
        $("micButton");

      if (micEnabled) {

        button.textContent =
          "🎤 Mic ON";

        button.classList.add(
          "active"
        );

      } else {

        button.textContent =
          "🔇 Mic OFF";

        button.classList.remove(
          "active"
        );
      }
    }


    /* =========================================
       WEBRTC
    ========================================= */

    function rtcConfig() {

      return {
        iceServers: [
          {
            urls:
              "stun:stun.l.google.com:19302"
          },
          {
            urls:
              "stun:stun1.l.google.com:19302"
          }
        ]
      };
    }


    function getMemberBySocketId(
      socketId
    ) {

      if (!currentClub) return null;

      return currentClub.members.find(
        member =>
          member.socketId === socketId
      );
    }


    function getUsernameBySocket(
      username
    ) {

      if (!currentClub) return null;

      const member =
        currentClub.members.find(
          m => m.username === username
        );

      return member?.socketId || null;
    }


    function isSpeaker(username) {

      if (!currentClub) return false;

      return currentClub.seats
        .includes(username);
    }


    function shouldInitiate(
      mySocketId,
      otherSocketId
    ) {

      /*
        Socket ID tokko qofa offer jalqaba.
        Kun offer lama yeroo tokkoon
        uumamuu hir'isa.
      */

      return mySocketId <
        otherSocketId;
    }


    async function getOrCreatePeer(
      remoteSocketId,
      initiator
    ) {

      if (
        peers.has(remoteSocketId)
      ) {

        return peers.get(
          remoteSocketId
        );
      }

      const peer =
        new RTCPeerConnection(
          rtcConfig()
        );

      peers.set(
        remoteSocketId,
        peer
      );


      /* LOCAL AUDIO */

      if (localStream) {

        localStream
          .getAudioTracks()
          .forEach(
            track => {

              try {

                peer.addTrack(
                  track,
                  localStream
                );

              } catch (e) {}
            }
          );
      }


      /* REMOTE AUDIO */

      peer.ontrack =
        event => {

          const stream =
            event.streams[0];

          if (!stream) return;

          let audio =
            remoteAudios.get(
              remoteSocketId
            );

          if (!audio) {

            audio =
              document.createElement(
                "audio"
              );

            audio.autoplay = true;

            audio.playsInline = true;

            audio.controls = false;

            audio.style.display =
              "none";

            $("audioContainer")
              .appendChild(audio);

            remoteAudios.set(
              remoteSocketId,
              audio
            );
          }

          audio.srcObject =
            stream;

          audio.play()
            .catch(
              () => {}
            );
        };


      /* ICE */

      peer.onicecandidate =
        event => {

          if (
            event.candidate &&
            socket
          ) {

            socket.emit(
              "webrtc-ice",
              {
                target:
                  remoteSocketId,

                candidate:
                  event.candidate
              }
            );
          }
        };


      peer.onconnectionstatechange =
        () => {

          const state =
            peer.connectionState;

          if (
            state === "failed" ||
            state === "closed" ||
            state === "disconnected"
          ) {

            removePeer(
              remoteSocketId
            );
          }
        };


      /* OFFER */

      if (initiator) {

        try {

          const offer =
            await peer.createOffer();

          await peer.setLocalDescription(
            offer
          );

          socket.emit(
            "webrtc-offer",
            {
              target:
                remoteSocketId,

              offer:
                peer.localDescription
            }
          );

        } catch (error) {

          console.error(
            "Create offer error:",
            error
          );
        }
      }

      return peer;
    }


    async function createPeerConnection(
      remoteSocketId
    ) {

      if (!socket) return;

      if (
        remoteSocketId === socket.id
      ) return;

      const member =
        getMemberBySocketId(
          remoteSocketId
        );

      if (!member) return;

      /*
        Sagalee dhugaa dabarsuuf:
        speaker qofa peer keessa gala.
      */

      if (
        !isSpeaker(
          member.username
        )
      ) {

        return;
      }

      const initiator =
        shouldInitiate(
          socket.id,
          remoteSocketId
        );

      await getOrCreatePeer(
        remoteSocketId,
        initiator
      );
    }


    async function syncVoiceConnections() {

      if (
        !socket ||
        !currentClub
      ) return;

      /*
        Speaker members qofa.
      */

      const speakers =
        currentClub.members.filter(
          member =>
            isSpeaker(
              member.username
            ) &&
            member.socketId &&
            member.socketId !==
              socket.id
        );

      const wanted =
        new Set(
          speakers.map(
            m => m.socketId
          )
        );

      /*
        Peer hin barbaachifne cufi.
      */

      for (
        const [
          socketId,
          peer
        ] of peers.entries()
      ) {

        if (
          !wanted.has(socketId)
        ) {

          try {
            peer.close();
          } catch (e) {}

          peers.delete(
            socketId
          );

          const audio =
            remoteAudios.get(
              socketId
            );

          if (audio) {

            audio.srcObject =
              null;

            audio.remove();

            remoteAudios.delete(
              socketId
            );
          }
        }
      }


      /*
        Peer barbaachisu uumi.
      */

      for (
        const member of speakers
      ) {

        await createPeerConnection(
          member.socketId
        );
      }
    }


    async function updatePeerTracks() {

      if (!localStream) return;

      for (
        const [
          socketId,
          peer
        ] of peers.entries()
      ) {

        const sender =
          peer.getSenders()
            .find(
              s =>
                s.track &&
                s.track.kind ===
                  "audio"
            );

        const track =
          localStream
            .getAudioTracks()[0];

        if (
          sender &&
          track
        ) {

          try {

            await sender.replaceTrack(
              track
            );

          } catch (e) {}
        }
      }
    }


    async function flushCandidates(
      remoteSocketId
    ) {

      const list =
        pendingCandidates.get(
          remoteSocketId
        );

      if (!list) return;

      const peer =
        peers.get(
          remoteSocketId
        );

      if (!peer) return;

      for (
        const candidate of list
      ) {

        try {

          await peer.addIceCandidate(
            new RTCIceCandidate(
              candidate
            )
          );

        } catch (e) {}
      }

      pendingCandidates.delete(
        remoteSocketId
      );
    }


    function removePeer(
      remoteSocketId
    ) {

      const peer =
        peers.get(
          remoteSocketId
        );

      if (peer) {

        try {
          peer.close();
        } catch (e) {}
      }

      peers.delete(
        remoteSocketId
      );

      const audio =
        remoteAudios.get(
          remoteSocketId
        );

      if (audio) {

        audio.srcObject =
          null;

        audio.remove();

        remoteAudios.delete(
          remoteSocketId
        );
      }
    }


    /* =========================================
       CHAT
    ========================================= */

    function sendChat() {

      const input =
        $("chatInput");

      const message =
        input.value.trim();

      if (!message) return;

      socket.emit(
        "chatMessage",
        {
          message
        }
      );

      input.value = "";
    }


    function addChatMessage(item) {

      const box =
        $("chatMessages");

      const div =
        document.createElement("div");

      div.className =
        "message";

      div.innerHTML = `
        <b>${escapeHtml(item.username)}:</b>
        ${escapeHtml(item.message)}
      `;

      box.appendChild(div);

      box.scrollTop =
        box.scrollHeight;
    }


    /* =========================================
       GIFTS
    ========================================= */

    function sendGift(gift) {

      if (!socket) return;

      socket.emit(
        "sendGift",
        {
          gift
        }
      );
    }


    function addGiftMessage(item) {

      const box =
        $("chatMessages");

      const div =
        document.createElement("div");

      div.className =
        "message";

      div.innerHTML = `
        🎁 <b>${escapeHtml(item.username)}</b>
        ${item.gift}
      `;

      box.appendChild(div);

      box.scrollTop =
        box.scrollHeight;
    }


    /* =========================================
       OWNER CONTROLS
    ========================================= */

    function ownerMute(username) {

      username =
        decodeURIComponent(username);

      socket.emit(
        "ownerMute",
        {
          username
        }
      );
    }


    function removeMember(username) {

      username =
        decodeURIComponent(username);

      if (
        !confirm(
          "Nama kana room keessaa baasuu?"
        )
      ) return;

      socket.emit(
        "removeMember",
        {
          username
        }
      );
    }


    /* =========================================
       SHARE
    ========================================= */

    async function shareRoom() {

      if (!currentClub) return;

      const url =
        location.origin +
        location.pathname +
        "?club=" +
        encodeURIComponent(
          currentClub.id
        );

      const text =
        "Waliin-GM Room: " +
        currentClub.name +
        "\nID: " +
        currentClub.id +
        "\n" +
        url;

      if (
        navigator.share
      ) {

        try {

          await navigator.share({
            title:
              currentClub.name,

            text,

            url
          });

          return;

        } catch (e) {}
      }

      try {

        await navigator.clipboard.writeText(
          text
        );

        alert(
          "🔗 Link fi ID copy ta'eera."
        );

      } catch (e) {

        alert(
          text
        );
      }
    }


    /* =========================================
       LEAVE ROOM
    ========================================= */

    function leaveRoom() {

      if (
        !confirm(
          "Room keessaa ba'uu barbaaddaa?"
        )
      ) return;

      closeRoom();
    }


    function closeRoom() {

      if (socket) {

        socket.emit(
          "leaveClub"
        );
      }

      peers.forEach(
        peer => {

          try {
            peer.close();
          } catch (e) {}
        }
      );

      peers.clear();

      remoteAudios.forEach(
        audio => {

          try {
            audio.pause();
            audio.srcObject = null;
            audio.remove();
          } catch (e) {}
        }
      );

      remoteAudios.clear();

      stopMicrophone();

      currentClub = null;

      $("roomPage")
        .classList.add("hidden");

      $("homePage")
        .classList.remove("hidden");
    }


    /* =========================================
       MODAL
    ========================================= */

    function openModal(
      title,
      content
    ) {

      $("modalTitle").textContent =
        title;

      $("modalContent").innerHTML =
        content;

      $("modal")
        .classList.remove("hidden");
    }


    function closeModal() {

      $("modal")
        .classList.add("hidden");
    }


    function showComing(name) {

      openModal(
        "🚧 " + name,
        `
          <p style="line-height:1.6">
            ${name} feature irratti
            itti fufnee hojjenna.
          </p>
        `
      );
    }


    function openSettings() {

      openModal(
        "⚙️ Settings",
        `
          <p style="margin-bottom:12px">
            <b>Account:</b>
            ${escapeHtml(
              currentUser?.username ||
              ""
            )}
          </p>

          <p style="margin-bottom:12px">
            <b>Email:</b>
            ${escapeHtml(
              currentUser?.email ||
              ""
            )}
          </p>

          <button onclick="logout()">
            🚪 Logout
          </button>
        `
      );
    }


    /* =========================================
       LOGOUT
    ========================================= */

    async function logout() {

      try {

        await fetch(
          "/api/logout",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body: JSON.stringify({
              token:
                currentUser?.token
            })
          }
        );

      } catch (e) {}

      if (socket) {

        try {
          socket.disconnect();
        } catch (e) {}
      }

      stopMicrophone();

      peers.forEach(
        peer => {

          try {
            peer.close();
          } catch (e) {}
        }
      );

      peers.clear();

      localStorage.removeItem(
        "waliin_gm_user"
      );

      currentUser = null;

      currentClub = null;

      closeModal();

      $("homePage")
        .classList.add("hidden");

      $("roomPage")
        .classList.add("hidden");

      $("authPage")
        .classList.remove("hidden");
    }


    /* =========================================
       AUTO LOGIN
    ========================================= */

    function autoLogin() {

      const saved =
        localStorage.getItem(
          "waliin_gm_user"
        );

      if (!saved) return;

      try {

        currentUser =
          JSON.parse(saved);

        connectSocket();

        showHome();

      } catch (e) {

        localStorage.removeItem(
          "waliin_gm_user"
        );
      }
    }


    /* =========================================
       URL CLUB JOIN
    ========================================= */

    function checkRoomLink() {

      const params =
        new URLSearchParams(
          location.search
        );

      const clubId =
        params.get("club");

      if (
        clubId &&
        currentUser &&
        socket
      ) {

        setTimeout(
          () => {

            socket.emit(
              "joinClub",
              {
                clubId,
                username:
                  currentUser.username
              },
              response => {

                if (
                  response &&
                  response.success
                ) {

                  currentClub =
                    response.club;

                  openRoom();

                } else {

                  alert(
                    "Room link kun sirrii miti ykn room cufameera."
                  );
                }
              }
            );

          },
          1000
        );
      }
    }


    /* =========================================
       ESCAPE HTML
    ========================================= */

    function escapeHtml(text) {

      const div =
        document.createElement(
          "div"
        );

      div.textContent =
        String(text);

      return div.innerHTML;
    }


    /* =========================================
       START
    ========================================= */

    window.addEventListener(
      "load",
      () => {

        autoLogin();

        setTimeout(
          checkRoomLink,
          1200
        );
      }
    );

  </script>

</body>
</html>
