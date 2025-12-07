document.addEventListener("DOMContentLoaded", () => {
    // ----------------- 상수 정의 -----------------
    const BADGE_RANKS = ["없음", "동 훈장", "은 훈장", "금 훈장", "다이아 훈장"];
    const REWARD_POINTS = {
        MISSION_COMPLETE: 50,
        PER_MINUTE: 2,
        QA_QUESTION: 10,
        QA_REPLY: 5
    };
    const MAX_DAILY_QA_REWARD = 2;
    const ADMIN_EMAIL = "okbitdongari@gmail.com";

    // 기록장 관련 상수 추가
    const NOTE_TYPES = ['전체', '목표', '공부 내용', '독서 기록장', '일기장'];

    if (typeof firebase === 'undefined') {
        console.error("Firebase SDK가 로드되지 않았습니다. CodePen JS 설정에 스크립트를 추가했는지 확인하세요.");
        return;
    }

    const app = firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth();
    const db = firebase.firestore();

    let currentUser = null;
    let isAdmin = false;

    // ----------------- 전역 상태 및 로컬 스토리지 데이터 -----------------
    let elapsedSeconds = parseInt(localStorage.getItem("elapsedSeconds") || "0");
    let missionStartTime = parseInt(localStorage.getItem("missionStartTime") || "0");
    let missionDuration = parseInt(localStorage.getItem("missionDuration") || "30");
    let timerInterval = null;
    let lastMinute = Math.floor(elapsedSeconds / 60);

    let username = localStorage.getItem("username") || "게스트";
    let score = 0;
    let badge = "없음";
    let ownedBadgeName = localStorage.getItem("ownedBadgeName") || "없음";
    let diamondBadgeCount = parseInt(localStorage.getItem("diamondBadgeCount") || "0");
    let totalStudyTime = 0;
    let bestStudyTime = 0;

    // QA 관련 전역 상태
    let allQaData = [];
    let currentCat = '전체';

    // 기록장 관련 전역 상태
    let currentCalendarDate = new Date(); // 현재 달력에 표시되는 월
    let selectedNoteDate = null; // 사용자가 선택한 날짜 (YYYY-MM-DD 형식)
    let currentNoteType = '전체'; // 현재 노트 탭 필터
    let currentDayNotes = []; // 선택된 날짜의 노트 데이터

    // DOM 요소 캐싱
    const sections = {
        main: document.getElementById("mainSection"),
        auth: document.getElementById("authSection"),
        shop: document.getElementById("shopSection"),
        profile: document.getElementById("profileSection"),
        board: document.getElementById("boardSection"),
        record: document.getElementById("recordSection"), // 기록장 섹션 추가
        report: createReportSection()
    };

    const dropdown = document.getElementById("dropdownMenu");
    const hamburger = document.getElementById("hamburger");
    const missionModal = document.getElementById("missionModal"); // 미션 모달 캐싱

    // QA 관련 DOM
    const qaListEl = document.getElementById('qaQuestionList');
    const filters = Array.from(document.querySelectorAll('.qa-filter'));
    const qaCreateModal = document.getElementById('qaCreateModal');
    const qaDetailModal = document.getElementById('qaDetailModal');
    const qaCategory = document.getElementById('qaCategory');
    const qaTitle = document.getElementById('qaTitle');
    const qaContent = document.getElementById('qaContent');
    const qaDetailTitle = document.getElementById('qaDetailTitle');
    const qaDetailContent = document.getElementById('qaDetailContent');
    const qaReplyList = document.getElementById('qaReplyList');
    const qaReplyInput = document.getElementById('qaReplyInput');

    // 기록장 관련 DOM
    const calendarEl = document.getElementById('calendarBody');
    const calendarTitle = document.getElementById('calendarTitle');
    const noteListEl = document.getElementById('noteList');
    const noteModal = document.getElementById('noteModal'); // HTML ID 확인 완료
    const noteTypeSelect = document.getElementById('noteTypeSelect');
    const noteTitleInput = document.getElementById('noteTitle');
    const noteContentInput = document.getElementById('noteContent');
    const noteTabs = document.getElementById('noteTabs');


    // ----------------- Firebase 데이터 관리 -----------------

    async function loadUserData(user) {
        if (!user) return;
        try {
            const doc = await db.collection("users").doc(user.uid).get();
            if (doc.exists) {
                const data = doc.data();

                username = data.username || user.email.split('@')[0];
                localStorage.setItem("username", username);

                score = data.score || 0;
                badge = data.badge || "없음";
                ownedBadgeName = data.ownedBadgeName || "없음";
                diamondBadgeCount = data.diamondBadgeCount || 0;
                totalStudyTime = data.totalStudyTime || 0;
                bestStudyTime = data.bestStudyTime || 0;
                elapsedSeconds = data.elapsedSeconds || 0;
                lastMinute = Math.floor(elapsedSeconds / 60);
            } else {
                username = user.email.split('@')[0];
                await saveUserData({
                    username: username,
                    score: 0, badge: "없음", ownedBadgeName: "없음",
                    diamondBadgeCount: 0, totalStudyTime: 0,
                    bestStudyTime: 0, elapsedSeconds: 0
                });
            }
        } catch (error) {
            console.error("Error loading user data:", error);
        }
    }

    async function saveUserData(data) {
        if (!currentUser) return;
        try {
            await db.collection("users").doc(currentUser.uid).set(data, { merge: true });
            if (data.username !== undefined) localStorage.setItem("username", data.username);
            if (data.ownedBadgeName !== undefined) localStorage.setItem("ownedBadgeName", data.ownedBadgeName);
            if (data.diamondBadgeCount !== undefined) localStorage.setItem("diamondBadgeCount", data.diamondBadgeCount);
        } catch (error) {
            console.error("Error saving user data:", error);
        }
    }

    async function addRewardPoints(points) {
        if (!currentUser) return;
        score += points;
        await saveUserData({ score: score });
        updateUserUI();
    }

    async function addQARewardPoints(type, points) {
        if (!currentUser) return false;

        const today = new Date().toISOString().split('T')[0];
        const rewardRef = db.collection("rewards").doc(currentUser.uid);

        try {
            const doc = await rewardRef.get();
            let rewards = doc.exists ? doc.data() : { date: today, questionCount: 0, replyCount: 0 };

            if (rewards.date !== today) {
                rewards = { date: today, questionCount: 0, replyCount: 0 };
            }

            let currentCount = (type === 'question') ? rewards.questionCount : rewards.replyCount;
            let countField = (type === 'question') ? 'questionCount' : 'replyCount';
            let actionText = (type === 'question') ? '질문 등록' : '답글 등록';

            if (currentCount >= MAX_DAILY_QA_REWARD) {
                console.log(`${actionText} 점수 지급 제한: 하루 최대 ${MAX_DAILY_QA_REWARD}회 초과.`);
                return false;
            }

            currentCount++;
            score += points;

            await saveUserData({ score: score });
            await rewardRef.set({ ...rewards, [countField]: currentCount }, { merge: true });

            updateUserUI();
            alert(`${actionText} 완료! ${points}점이 지급되었습니다. (오늘 ${currentCount}/${MAX_DAILY_QA_REWARD}회)`);
            return true;

        } catch (error) {
            console.error("Error adding QA reward:", error);
            return false;
        }
    }

    async function equipBadge(badgeName) {
        badge = badgeName;
        await saveUserData({ badge: badge });
        alert(`${badgeName} 훈장을 착용했습니다.`);
        updateUserUI();
        bindShop();
    }


    // ----------------- Firebase Authentication 상태 리스너 -----------------

    auth.onAuthStateChanged(async (user) => {
        currentUser = user;
        isAdmin = (user && user.email === ADMIN_EMAIL);

        if (user) {
            await loadUserData(user);
            updateUserUI();
            showSection("main");

            if (localStorage.getItem("timerRunning") === "true") startTimer(true);

            // 로그인 시 오늘 날짜를 선택된 날짜로 설정
            if (!selectedNoteDate) {
                selectedNoteDate = new Date().toISOString().split('T')[0];
            }
            // recordSection이 활성화되면 캘린더를 렌더링하도록 변경
        } else {
            username = "게스트";
            localStorage.removeItem("username");
            score = 0; badge = "없음";
            ownedBadgeName = "없음";
            diamondBadgeCount = 0;
            updateUserUI();
        }
        updateMissionDisplay();
        updateTimerDisplay();
        bindShop();
        setupQaListener();
    });

    // ----------------- 유틸리티 함수 -----------------

    function showSection(name) {
        if (name === "auth" && currentUser) return;
        Object.keys(sections).forEach(key => sections[key].style.display = "none");
        if (sections[name]) {
            sections[name].style.display = "block";
        }
        if (dropdown) dropdown.style.display = "none";

        if (name === "profile" && currentUser) {
            document.getElementById("profileIdInput").value = username;
        }

        // 기록장 섹션 진입 시 달력 렌더링 및 노트 로드
        if (name === "record" && currentUser) {
            if (!selectedNoteDate) {
                selectedNoteDate = new Date().toISOString().split('T')[0];
            }
            renderCalendar(currentCalendarDate);
            loadNotesForDate(selectedNoteDate);
        }
    }

    function createReportSection() {
        const report = document.createElement("section");
        report.id = "reportSection";
        report.style.display = "none";
        report.className = "app-section";
        const iframe = document.createElement("iframe");
        iframe.style.width = "100%";
        iframe.style.height = "100vh";
        iframe.style.border = "none";
        document.getElementById("app").appendChild(report);
        report.appendChild(iframe);
        return report;
    }

    function escapeHtml(s = '') {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ----------------- 모달 제어 함수 -----------------
    function openModal(modal) {
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');
    }

    function closeModal(modal) {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
    }
    // ----------------------------------------------------


    // ----------------- UI 및 메뉴 바인딩 -----------------

    function updateUserUI() {
        const info = document.getElementById("userInfo");
        const isLoggedIn = !!currentUser;

        if (!isLoggedIn) {
            if (info) info.style.display = "none";
            const authLink = document.getElementById("authLink");
            authLink.textContent = "🔑 로그인/회원가입";
            authLink.onclick = () => showSection("auth");
            if (authLink) authLink.style.display = 'flex';
            return;
        }

        if (info) {
            info.style.display = "flex";
            info.onclick = () => showSection("profile");
        }

        let badgeDisplay = badge;
        if (badge === "없음") {
            badgeDisplay = "미착용";
        } else if (badge === "다이아 훈장" && diamondBadgeCount > 0) {
            badgeDisplay += ` (${diamondBadgeCount}개)`;
        }

        document.getElementById("usernameDisplay").textContent = username;
        document.getElementById("scoreDisplay").textContent = "점수: " + score;
        document.getElementById("userBadge").textContent = badgeDisplay;

        document.getElementById("profileName").textContent = `ID: ${username}`;
        document.getElementById("profileScore").textContent = "점수: " + score;
        document.getElementById("profileBadge").textContent = "착용 배지: " + badgeDisplay;

        const userPointsEl = document.getElementById("userPoints");
        if (userPointsEl) userPointsEl.textContent = "내 점수: " + score;

        const diamondCountEl = document.getElementById("diamondBadgeCount");
        if (diamondCountEl) {
            diamondCountEl.textContent = `💎 다이아 훈장 보유: ${diamondBadgeCount}개`;
        }

        const authLink = document.getElementById("authLink");
        if (authLink) {
            authLink.style.display = 'none';
        }

        const formatTime = (seconds) => {
            const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
            const m = String(Math.floor(seconds % 3600 / 60)).padStart(2, '0');
            const s = String(seconds % 60).padStart(2, '0');
            return `${h}:${m}:${s}`;
        };

        document.getElementById("totalTimeDisplay").textContent = `누적 공부 시간: ${formatTime(totalStudyTime)}`;
        document.getElementById("bestTimeDisplay").textContent = `최고 공부 시간: ${formatTime(bestStudyTime)}`;
    }

    async function updateUserId() {
        const newId = document.getElementById("profileIdInput").value.trim();
        if (!newId) return alert("사용자 ID를 입력해주세요.");
        if (newId === username) return alert("ID가 변경되지 않았습니다.");

        try {
            const usersRef = db.collection('users');
            const snapshot = await usersRef.where('username', '==', newId).get();

            if (!snapshot.empty && snapshot.docs[0].id !== currentUser.uid) {
                return alert("이미 사용 중인 사용자 ID입니다.");
            }

            username = newId;
            await saveUserData({ username: username });
            alert(`사용자 ID가 ${username}으로 변경되었습니다.`);
            updateUserUI();

        } catch (error) {
            console.error("ID 업데이트 오류:", error);
            alert("ID 업데이트 중 오류가 발생했습니다.");
        }
    }


    hamburger.addEventListener("click", () => {
        dropdown.style.display = dropdown.style.display === "flex" ? "none" : "flex";
    });

    document.getElementById("logo").onclick = () => showSection("main");

    const menuMap = {
        mainLink: "main", shopLink: "shop", logLink: "record", profileLink: "profile", boardLink: "board", recordLink: "record", reportLink: "report"
    };

    Object.keys(menuMap).forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;

        el.addEventListener("click", e => {
            e.preventDefault();
            const sectionName = menuMap[id];

            if (!currentUser && ["shop", "profile", "board", "record", "report"].includes(sectionName)) {
                alert("로그인 후 이용 가능합니다.");
                showSection("auth");
                return;
            }

            if (id === "reportLink") {
                sections.report.querySelector("iframe").src = "https://funny-meringue-77c08d.netlify.app/";
            }
            showSection(sectionName);
        });
    });

    // ----------------- 로그인/회원가입 기능 (Firebase Auth) -----------------

    function toggleAuth(showSignup) {
        document.getElementById("signupForm").style.display = showSignup ? "block" : "none";
        document.getElementById("loginForm").style.display = showSignup ? "none" : "block";
    }

    async function login() {
        const id = document.getElementById("loginId").value;
        const pw = document.getElementById("loginPw").value;
        if (!id || !pw) return alert("이메일과 비밀번호를 입력하세요.");

        try {
            await auth.signInWithEmailAndPassword(id, pw);
        } catch (error) {
            alert(`로그인 실패: ${error.message}`);
        }
    }

    async function signup() {
        const id = document.getElementById("signupId").value;
        const pw = document.getElementById("signupPw").value;
        const pwc = document.getElementById("signupPwConfirm").value;
        if (!id || !pw || !pwc) return alert("모든 항목을 입력해주세요.");
        if (pw !== pwc) return alert("비밀번호가 일치하지 않습니다.");

        try {
            const userCredential = await auth.createUserWithEmailAndPassword(id, pw);
            const user = userCredential.user;

            const initialUsername = user.email.split('@')[0];

            await saveUserData({
                username: initialUsername,
                score: 0, badge: "없음", ownedBadgeName: "없음",
                diamondBadgeCount: 0, totalStudyTime: 0,
                bestStudyTime: 0, elapsedSeconds: 0
            });
            alert("회원가입이 완료되었습니다! 자동으로 로그인됩니다.");
        } catch (error) {
            alert(`회원가입 실패: ${error.message}`);
        }
    }

    async function logoutUser() {
        localStorage.removeItem("timerRunning");
        await auth.signOut();
        showSection("auth");
    }

    document.getElementById("loginBtn").onclick = login;
    document.getElementById("signupBtn").onclick = signup;
    document.getElementById("logoutBtn").onclick = logoutUser;
    document.getElementById("signupLink").onclick = () => toggleAuth(true);
    document.getElementById("loginLink").onclick = () => toggleAuth(false);

    document.getElementById("saveIdBtn").onclick = updateUserId;

    // ----------------- 미션 기능 -----------------

    function saveMission() {
        const text = document.getElementById("missionText").value || "오늘의 미션";
        missionDuration = parseInt(document.getElementById("missionTime").value) || 30;
        missionStartTime = Date.now();
        localStorage.setItem("missionText", text);
        localStorage.setItem("missionStartTime", missionStartTime);
        localStorage.setItem("missionDuration", missionDuration);

        closeModal(missionModal);
        updateMissionDisplay();
    }

    function updateMissionDisplay() {
        const fill = document.getElementById("dailyMissionProgress");
        const percentText = document.getElementById("dailyMissionPercent");
        const missionTextEl = document.getElementById("dailyMissionText");

        const start = parseInt(localStorage.getItem("missionStartTime") || "0");
        const durationSeconds = parseInt(localStorage.getItem("missionDuration") || "30") * 60;

        if (fill && percentText && start > 0) {
            const elapsed = Math.floor((Date.now() - start) / 1000);
            const percent = Math.min(100, Math.floor((elapsed / durationSeconds) * 100));
            fill.style.transform = `scaleX(${percent / 100})`;
            percentText.textContent = percent + "%";

            if (percent >= 100 && localStorage.getItem("missionCompleted") !== String(missionStartTime)) {
                addRewardPoints(REWARD_POINTS.MISSION_COMPLETE);
                localStorage.setItem("missionCompleted", missionStartTime);
                alert(`오늘의 미션을 완료했습니다! ${REWARD_POINTS.MISSION_COMPLETE}점이 지급되었습니다.`);
            }

        } else {
            if (fill) fill.style.transform = "scaleX(0)";
            if (percentText) percentText.textContent = "0%";
        }

        if (missionTextEl) {
            missionTextEl.textContent = localStorage.getItem("missionText") || "오늘의 미션을 설정해주세요!";
            missionTextEl.onclick = () => {
                if (!currentUser) return alert("로그인 후 미션을 설정할 수 있습니다.");
                openModal(missionModal);
            }
        }
    }

    document.getElementById("cancelMissionBtn").onclick = () => closeModal(missionModal);
    document.getElementById("saveMissionBtn").onclick = saveMission;

    // ----------------- 타이머 기능 -----------------

    function updateTimerDisplay() {
        const m = String(Math.floor(elapsedSeconds % 3600 / 60)).padStart(2, '0');
        const s = String(elapsedSeconds % 60).padStart(2, '0');
        const el = document.getElementById("timeText");
        if (el) el.textContent = `${m}:${s}`;

        const currentMinute = Math.floor(elapsedSeconds / 60);
        if (currentMinute > lastMinute) {
            lastMinute = currentMinute;
            addRewardPoints(REWARD_POINTS.PER_MINUTE);
        }
        updateUserUI();
    }

    async function startTimer(isResume = false) {
        const btn = document.getElementById("startPauseBtn");
        if (!btn || !currentUser) return alert("로그인 후 이용 가능합니다.");

        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
            btn.textContent = "▶ 시작";
            localStorage.setItem("timerRunning", "false");

            if (elapsedSeconds > bestStudyTime) {
                bestStudyTime = elapsedSeconds;
            }
            // 일시 정지 시 현재 공부 시간(elapsedSeconds)은 초기화되지만, DB에 최종 누적 시간과 최고 기록은 저장
            await saveUserData({ elapsedSeconds: 0, totalStudyTime: totalStudyTime, bestStudyTime: bestStudyTime });

            elapsedSeconds = 0;
            lastMinute = 0;
            updateTimerDisplay();
            updateUserUI();
            return;
        }

        btn.textContent = "⏸ 정지";
        localStorage.setItem("timerRunning", "true");

        timerInterval = setInterval(async () => {
            elapsedSeconds++;
            totalStudyTime++;
            localStorage.setItem("elapsedSeconds", elapsedSeconds);

            if (elapsedSeconds % 60 === 0) {
                // 1분마다 DB에 현재까지의 elapsedSeconds와 totalStudyTime 저장 (누적)
                await saveUserData({ elapsedSeconds: elapsedSeconds, totalStudyTime: totalStudyTime });
            }

            updateTimerDisplay();
            updateMissionDisplay();
        }, 1000);
    }

    const startPauseBtn = document.getElementById("startPauseBtn");
    if (startPauseBtn) startPauseBtn.onclick = startTimer;

    // ----------------- 상점 기능 (순차 구매 로직 적용) -----------------

    function bindShop() {
        const badgeRanks = BADGE_RANKS;
        const currentOwnedRankIndex = badgeRanks.indexOf(ownedBadgeName);

        document.querySelectorAll(".buy-btn").forEach(btn => {
            const badgeName = btn.parentElement.querySelector(".item-name").textContent.trim();
            const price = parseInt(btn.dataset.price);

            const btnRankIndex = badgeRanks.indexOf(badgeName);

            btn.classList.remove("purchased", "locked");
            btn.disabled = false;
            let canBuy = false;
            let isDiamondBadge = (badgeName === "다이아 훈장");

            if (isDiamondBadge) {
                if (currentOwnedRankIndex >= badgeRanks.indexOf("금 훈장")) {
                    canBuy = true;
                    btn.textContent = `구매 (${price}점)`;
                } else {
                    btn.textContent = "잠금 (금 훈장 필요)";
                    btn.classList.add("locked");
                    btn.disabled = true;
                }
            } else if (btnRankIndex <= currentOwnedRankIndex) {
                if (badge === badgeName) {
                    btn.textContent = "착용 중";
                } else {
                    btn.textContent = "착용";
                    btn.onclick = () => equipBadge(badgeName);
                    return;
                }
                btn.classList.add("purchased");
            } else if (btnRankIndex === currentOwnedRankIndex + 1) {
                canBuy = true;
                btn.textContent = `구매 (${price}점)`;
            } else {
                const requiredBadgeName = badgeRanks[btnRankIndex - 1];
                btn.textContent = `잠금 (${requiredBadgeName} 필요)`;
                btn.classList.add("locked");
                btn.disabled = true;
            }

            btn.onclick = async () => {
                if (btn.disabled || !currentUser) return alert("로그인 또는 이미 구매했거나 잠금 상태입니다.");
                if (canBuy) {
                    if (score >= price) {
                        score -= price;

                        let updateData = { score: score };

                        if (isDiamondBadge) {
                            diamondBadgeCount++;
                            ownedBadgeName = badgeName;
                            badge = badgeName;

                            updateData = { ...updateData, diamondBadgeCount: diamondBadgeCount, ownedBadgeName: ownedBadgeName, badge: badge };
                            alert(`다이아 훈장 구매 완료! (${diamondBadgeCount}개 보유)`);
                        } else {
                            ownedBadgeName = badgeName;
                            badge = badgeName;

                            updateData = { ...updateData, badge: badge, ownedBadgeName: ownedBadgeName };
                            alert(`구매 완료! ${badgeName} 훈장을 획득하고 착용했습니다.`);
                        }

                        await saveUserData(updateData);
                        updateUserUI();
                        bindShop();

                    } else {
                        alert("점수가 부족합니다.");
                    }
                }
            };
        });
    }

// ----------------- QA 게시판 기능 (Firestore) -----------------

    let qaListener = null;

    function setupQaListener() {
        if (qaListener) qaListener();

        if (!currentUser) {
            allQaData = [];
            renderQA();
            return;
        }

        qaListener = db.collection("questions")
            .orderBy("timestamp", "desc")
            .onSnapshot((snapshot) => {
                allQaData = [];
                snapshot.forEach(doc => {
                    allQaData.push({ ...doc.data(), id: doc.id });
                });
                renderQA();
            }, (error) => {
                console.error("QA Data listener error:", error);
            });
    }

    function renderQA() {
        if (!qaListEl) return;
        qaListEl.innerHTML = '';

        const filtered = allQaData
            .filter(item => currentCat === '전체' || (item.category === currentCat));

        if (filtered.length === 0) {
            const li = document.createElement('li');
            li.className = 'qa-empty';
            li.textContent = '등록된 질문이 없습니다.';
            qaListEl.appendChild(li);
            return;
        }

        filtered.forEach((item) => {
            const li = document.createElement('li');
            li.className = 'qa-item';
            li.setAttribute('role', 'button');
            const replyCount = (item.replies || []).length;
            const preview = (item.content || '').length > 120 ? item.content.slice(0, 120) + '...' : (item.content || '');
            li.innerHTML = `
                <span class="qa-tag">${escapeHtml(item.category || '기타')}</span>
                <p class="qa-title">${escapeHtml(item.title || '제목 없음')} <span style="font-size:0.8em; color:#777;">[답글 ${replyCount}]</span></p>
                <p class="qa-preview">${escapeHtml(preview)}</p>
            `;
            li.addEventListener('click', () => showQADetail(item.id));
            qaListEl.appendChild(li);
        });
    }

    function renderReplies(q, qId) {
        qaReplyList.innerHTML = '';
        const replies = Array.isArray(q.replies) ? q.replies : [];

        if (replies.length === 0) {
            const li = document.createElement('li');
            li.textContent = "아직 등록된 답글이 없습니다.";
            li.style.cssText = 'background: #fff; text-align: center; border-left: none; color: #777;';
            qaReplyList.appendChild(li);
        } else {
            replies.forEach((r, index) => {
                const li = document.createElement('li');
                li.className = 'qa-reply-item';

                const authorMatch = r.match(/^(.+?)\s+\(답변\):/);
                const replyAuthorPrefix = authorMatch ? `${authorMatch[1]}@` : null;

                const isReplyAuthor = currentUser && replyAuthorPrefix && currentUser.email.startsWith(replyAuthorPrefix);
                const showDeleteButton = isReplyAuthor || isAdmin;

                li.innerHTML = `
                    <span>${escapeHtml(r)}</span>
                    ${showDeleteButton ? `<button class="delete-reply-btn" data-index="${index}" data-qid="${qId}">삭제</button>` : ''}
                `;

                qaReplyList.appendChild(li);
            });

            qaReplyList.querySelectorAll('.delete-reply-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const index = parseInt(btn.dataset.index);
                    const qid = btn.dataset.qid;
                    deleteReply(qid, index);
                });
            });
        }
    }


    async function showQADetail(qId) {
        if (!qId) return;

        try {
            const doc = await db.collection("questions").doc(qId).get();
            if (!doc.exists) return alert("질문이 삭제되었거나 존재하지 않습니다.");

            const q = { ...doc.data(), id: doc.id };

            qaDetailModal.querySelector('.qa-modal-inner').dataset.questionId = qId;

            qaDetailTitle.textContent = `[${q.category || '기타'}] ${q.title || ''}`;
            qaDetailContent.textContent = q.content || '';

            renderReplies(q, qId);

            const deleteBtnContainer = document.getElementById('qaDetailActions');
            if (deleteBtnContainer) {
                const isAuthor = currentUser && q.author === currentUser.email;
                if (isAuthor || isAdmin) {
                    deleteBtnContainer.innerHTML = `<button id="deleteQuestionBtn" class="qa-button-delete">질문 삭제</button>`;
                    document.getElementById('deleteQuestionBtn').onclick = () => deleteQuestion(qId);
                } else {
                    deleteBtnContainer.innerHTML = '';
                }
            }


            openModal(qaDetailModal);
        } catch (error) {
            console.error("Error showing QA detail:", error);
        }
    }

    async function deleteQuestion(qId) {
        if (!currentUser) return alert("로그인 후 이용 가능합니다.");

        const q = allQaData.find(item => item.id === qId);
        if (!q) return;

        const isAuthor = q.author === currentUser.email;

        if (!isAuthor && !isAdmin) {
            return alert("작성자 또는 관리자만 삭제할 수 있습니다.");
        }

        if (confirm("정말로 이 질문을 삭제하시겠습니까?")) {
            try {
                await db.collection("questions").doc(qId).delete();
                closeModal(qaDetailModal);
                alert("질문이 삭제되었습니다.");
            } catch (error) {
                console.error("Error deleting question:", error);
                alert("질문 삭제에 실패했습니다.");
            }
        }
    }

    async function deleteReply(qId, index) {
        if (!currentUser) return alert("로그인 후 이용 가능합니다.");

        const q = allQaData.find(item => item.id === qId);
        if (!q) return;

        const replies = Array.isArray(q.replies) ? q.replies : [];
        const replyToDelete = replies[index];

        const authorMatch = replyToDelete.match(/^(.+?)\s+\(답변\):/);
        const replyAuthorPrefix = authorMatch ? `${authorMatch[1]}@` : null;

        const isReplyAuthor = currentUser && replyAuthorPrefix && currentUser.email.startsWith(replyAuthorPrefix);

        if (!isReplyAuthor && !isAdmin) {
            return alert("작성자 또는 관리자만 답글을 삭제할 수 있습니다.");
        }

        if (confirm("정말로 이 답글을 삭제하시겠습니까?")) {
            try {
                replies.splice(index, 1);

                await db.collection("questions").doc(qId).update({
                    replies: replies
                });

                alert("답글이 삭제되었습니다.");
                showQADetail(qId);
            } catch (error) {
                console.error("Error deleting reply:", error);
                alert("답글 삭제에 실패했습니다.");
            }
        }
    }


    document.getElementById('qaSubmitBtn').addEventListener('click', async () => {
        if (!currentUser) return alert("로그인 후 이용 가능합니다.");

        const title = qaTitle.value.trim();
        const content = qaContent.value.trim();
        const category = qaCategory.value;

        if (!title || !content) {
            alert('제목과 내용을 입력해 주세요.');
            return;
        }

        try {
            // 보상 지급 로직
            await addQARewardPoints('question', REWARD_POINTS.QA_QUESTION);

            await db.collection("questions").add({
                title, content, category,
                author: currentUser.email,
                replies: [],
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });

            closeModal(qaCreateModal);
            // alert("질문이 등록되었습니다."); // UX를 위해 alert 제거 (선택)

        } catch (error) {
            console.error("Error adding question:", error);
            alert("질문 등록에 실패했습니다.");
        }
    });

    document.getElementById('qaReplyBtn').addEventListener('click', async () => {
        if (!currentUser) return alert("로그인 후 이용 가능합니다.");

        const txt = qaReplyInput.value.trim();
        const currentQId = qaDetailModal.querySelector('.qa-modal-inner').dataset.questionId;

        if (!txt || !currentQId) return;

        try {
            // 보상 지급 로직
            await addQARewardPoints('reply', REWARD_POINTS.QA_REPLY);

            const authorPrefix = currentUser.email.split('@')[0]; // 이메일의 @ 앞부분만 사용
            const replyText = `${authorPrefix} (답변): ${txt}`;

            await db.collection("questions").doc(currentQId).update({
                replies: firebase.firestore.FieldValue.arrayUnion(replyText)
            });

            qaReplyInput.value = '';
            // alert("답글이 등록되었습니다."); // UX를 위해 alert 제거 (선택)

            showQADetail(currentQId);

        } catch (error) {
            console.error("Error adding reply:", error);
            alert("답글 등록에 실패했습니다.");
        }
    });


    document.querySelectorAll('.qa-close').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.target;
            if (target === 'create') closeModal(qaCreateModal);
            else if (target === 'detail') closeModal(qaDetailModal);
        });
    });

    document.querySelectorAll('.qa-modal').forEach(m => {
        m.addEventListener('click', (e) => {
            if (e.target === m) closeModal(m);
        });
    });

    filters.forEach(btn => {
        btn.addEventListener('click', () => {
            filters.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentCat = btn.dataset.cat || '전체';
            renderQA();
        });
    });

    document.getElementById('qaFab').addEventListener('click', () => {
        if (!currentUser) return alert("로그인 후 이용 가능합니다.");

        qaCategory.value = qaCategory.querySelector('option') ? qaCategory.querySelector('option').value : '국어';
        qaTitle.value = '';
        qaContent.value = '';
        openModal(qaCreateModal);
    });

// ----------------- 기록장 기능 (Calendar & Note) -----------------

    /**
     * 달력을 렌더링하고 클릭 이벤트를 바인딩합니다.
     * @param {Date} date - 표시할 연/월을 담고 있는 Date 객체
     */
    function renderCalendar(date) {
        if (!calendarEl || !calendarTitle) return;

        const year = date.getFullYear();
        const month = date.getMonth(); // 0-11

        calendarTitle.textContent = `${year}년 ${month + 1}월`;
        calendarEl.innerHTML = ''; // 기존 내용 지우기

        // 1. 월의 시작 요일과 마지막 날짜 계산
        const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0=일요일, 6=토요일
        const lastDateOfMonth = new Date(year, month + 1, 0).getDate();

        let dateCounter = 1;

        // 2. 6주(6행) 반복
        for (let i = 0; i < 6; i++) {
            const row = document.createElement('tr');
            let hasDateInRow = false; // 현재 행에 유효한 날짜가 있는지 확인하는 플래그

            // 3. 7일(7열) 반복
            for (let j = 0; j < 7; j++) {
                const cell = document.createElement('td');

                if (i === 0 && j < firstDayOfMonth) {
                    // 첫째 주, 월 시작 전 빈 칸
                    cell.classList.add('empty');
                } else if (dateCounter > lastDateOfMonth) {
                    // 마지막 날짜 이후 빈 칸
                    cell.classList.add('empty');
                } else {
                    // 날짜 채우기
                    const day = dateCounter;
                    cell.textContent = day;

                    const fullDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    cell.dataset.date = fullDate;
                    cell.classList.add('calendar-day');

                    // 오늘 날짜 표시
                    const today = new Date();
                    const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
                    if (fullDate === todayString) {
                        cell.classList.add('today');
                    }

                    // 클릭 이벤트 바인딩
                    cell.addEventListener('click', () => {
                        handleDateSelection(fullDate, cell);
                    });

                    dateCounter++;
                    hasDateInRow = true; // 유효한 날짜가 채워졌음을 표시
                }

                row.appendChild(cell);
            }

            // 수정된 종료 조건: 날짜가 모두 끝났고, 현재 행에 유효한 날짜가 하나도 없으면 중단
            if (dateCounter > lastDateOfMonth && !hasDateInRow) break;

            calendarEl.appendChild(row);
        }

        // 4. 달력 렌더링 후 selectedNoteDate가 현재 달에 있으면 하이라이트 유지
        if (selectedNoteDate) {
            const prevSelectedCell = calendarEl.querySelector(`[data-date="${selectedNoteDate}"]`);
            // 현재 달력에 선택된 날짜가 있다면 하이라이트
            if (prevSelectedCell) {
                prevSelectedCell.classList.add('selected');
            } else {
                noteListEl.innerHTML = '<p class="text-center text-gray">날짜를 선택해 기록을 확인하세요.</p>';
            }
        } else {
            noteListEl.innerHTML = '<p class="text-center text-gray">날짜를 선택해 기록을 확인하세요.</p>';
        }
    }

    /**
     * 날짜 선택 핸들러
     * @param {string} dateString - 선택된 날짜 (YYYY-MM-DD)
     * @param {HTMLElement} cell - 클릭된 달력 셀
     */
    async function handleDateSelection(dateString, cell) {
        if (!currentUser) {
            alert("로그인 후 이용 가능합니다.");
            return;
        }

        selectedNoteDate = dateString;

        // 하이라이트 업데이트 (현재 달력 내의 선택 상태만 해제)
        calendarEl.querySelectorAll('.calendar-day.selected').forEach(el => el.classList.remove('selected'));
        cell.classList.add('selected');

        // 노트 탭 활성화 (전체 탭을 기본으로)
        currentNoteType = '전체';
        document.querySelectorAll('.note-tab').forEach(tab => {
            tab.classList.remove('active');
            if (tab.dataset.type === '전체') tab.classList.add('active');
        });

        // 기록 불러오는 중 메시지 표시
        noteListEl.innerHTML = '<p class="text-center text-gray">기록을 불러오는 중...</p>';

        await loadNotesForDate(dateString);
    }

    /**
     * Firestore에서 특정 날짜의 노트를 불러오고 렌더링합니다.
     * @param {string} dateString - 날짜 (YYYY-MM-DD)
     */
    async function loadNotesForDate(dateString) {
        if (!currentUser || !dateString) return;

        try {
            // 서브 컬렉션 경로 사용
            const notesRef = db.collection('users').doc(currentUser.uid).collection('notes')
                .where('date', '==', dateString)
                .orderBy('timestamp', 'asc');

            const snapshot = await notesRef.get();
            currentDayNotes = [];
            snapshot.forEach(doc => {
                currentDayNotes.push({ id: doc.id, ...doc.data() });
            });

            renderNotes(); // 불러온 데이터로 노트 목록 렌더링

        } catch (error) {
            console.error("Error loading notes:", error);
            noteListEl.innerHTML = '<p class="text-center text-error">기록을 불러오는 중 오류가 발생했습니다.</p>';
        }
    }

    /**
     * 현재 선택된 노트 타입에 따라 노트 목록을 렌더링합니다.
     */
    function renderNotes() {
        noteListEl.innerHTML = '';

        const filteredNotes = currentDayNotes.filter(note =>
            currentNoteType === '전체' || note.type === currentNoteType
        );

        if (filteredNotes.length === 0) {
            noteListEl.innerHTML = `<p class="text-center text-gray">선택된 날짜 (${selectedNoteDate})에 ${currentNoteType} 기록이 없습니다.</p>`;
            return;
        }

        filteredNotes.forEach(note => {
            const item = document.createElement('div');
            item.className = `note-item note-type-${note.type.replace(/\s/g, '-')}`;
            item.innerHTML = `
                <div class="note-type-tag">${escapeHtml(note.type)}</div>
                <h4 class="note-title">${escapeHtml(note.title)}</h4>
                <p class="note-content-preview">${escapeHtml(note.content.substring(0, 100))}${note.content.length > 100 ? '...' : ''}</p>
                <div class="note-actions">
                    <button class="edit-note-btn" data-id="${note.id}">수정</button>
                    <button class="delete-note-btn" data-id="${note.id}">삭제</button>
                </div>
            `;

            noteListEl.appendChild(item);
        });

        // 이벤트 바인딩 (수정/삭제)
        document.querySelectorAll('.edit-note-btn').forEach(btn => btn.addEventListener('click', (e) => showNoteModal(e.target.dataset.id)));
        document.querySelectorAll('.delete-note-btn').forEach(btn => btn.addEventListener('click', (e) => deleteNote(e.target.dataset.id)));
    }

    /**
     * 새 노트 또는 수정 노트를 위한 모달을 표시합니다.
     * @param {string} noteId - 수정할 경우의 ID, 새 노트일 경우 null
     */
    function showNoteModal(noteId = null) {
        if (!currentUser) return alert("로그인 후 이용 가능합니다.");
        if (!selectedNoteDate) return alert("먼저 달력에서 기록할 날짜를 선택해주세요.");

        // 수정: noteId가 null일 경우 빈 문자열로 설정하여 'null' 문자열 방지
        noteModal.dataset.noteId = noteId || '';

        noteModal.querySelector('.modal-header h3').textContent = noteId ? '기록 수정' : '새 기록 등록';
        noteTitleInput.value = '';
        noteContentInput.value = '';
        noteTypeSelect.innerHTML = '';

        // 분야 선택 옵션 로드
        NOTE_TYPES.slice(1).forEach(type => { // '전체' 제외
            const option = document.createElement('option');
            option.value = type;
            option.textContent = type;
            noteTypeSelect.appendChild(option);
        });

        if (noteId) {
            const note = currentDayNotes.find(n => n.id === noteId);
            if (note) {
                noteTypeSelect.value = note.type;
                noteTitleInput.value = note.title;
                noteContentInput.value = note.content;
            }
        }

        openModal(noteModal);
    }

    /**
     * 노트 저장 (등록/수정)
     */
    async function saveNote() {
        if (!currentUser || !selectedNoteDate) return alert("로그인 상태가 아니거나 날짜가 선택되지 않았습니다.");

        const noteId = noteModal.dataset.noteId;
        const type = noteTypeSelect.value;
        const title = noteTitleInput.value.trim();
        const content = noteContentInput.value.trim();

        if (!type || !title || !content) {
            return alert("기록 분야, 제목, 내용을 모두 입력해주세요.");
        }

        const data = {
            date: selectedNoteDate,
            type: type,
            title: title,
            content: content
        };

        try {
            // Firestore 서브 컬렉션 경로 사용
            const notesCollectionRef = db.collection('users').doc(currentUser.uid).collection('notes');

            // 수정: noteId가 존재하고 빈 문자열이 아닐 때만 수정 로직 실행
            if (noteId) {
                // 수정
                await notesCollectionRef.doc(noteId).update(data);
                alert("기록이 수정되었습니다.");
            } else {
                // 등록
                data.timestamp = firebase.firestore.FieldValue.serverTimestamp();
                await notesCollectionRef.add(data);
                alert("새 기록이 등록되었습니다.");
            }

            closeModal(noteModal);
            await loadNotesForDate(selectedNoteDate); // 목록 새로고침

        } catch (error) {
            console.error("Error saving note:", error);
            alert("기록 저장에 실패했습니다.");
        }
    }

    /**
     * 노트 삭제
     */
    async function deleteNote(noteId) {
        if (!currentUser || !noteId || !selectedNoteDate) return;

        if (confirm("정말로 이 기록을 삭제하시겠습니까?")) {
            try {
                // Firestore 서브 컬렉션 경로 사용
                await db.collection('users').doc(currentUser.uid).collection('notes').doc(noteId).delete();
                alert("기록이 삭제되었습니다.");
                await loadNotesForDate(selectedNoteDate); // 목록 새로고침
            } catch (error) {
                console.error("Error deleting note:", error);
                alert("기록 삭제에 실패했습니다.");
            }
        }
    }

    // ----------------- 기록장 이벤트 바인딩 -----------------

    // 달력 이전/다음 달 이동
    const prevMonthBtn = document.getElementById('prevMonthBtn');
    const nextMonthBtn = document.getElementById('nextMonthBtn');
    if (prevMonthBtn) {
        prevMonthBtn.addEventListener('click', () => {
            currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
            selectedNoteDate = null; // 달 이동 시 선택 날짜 초기화
            renderCalendar(currentCalendarDate);
            noteListEl.innerHTML = '<p class="text-center text-gray">날짜를 선택해 기록을 확인하세요.</p>';
        });
    }

    if (nextMonthBtn) {
        nextMonthBtn.addEventListener('click', () => {
            currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
            selectedNoteDate = null; // 달 이동 시 선택 날짜 초기화
            renderCalendar(currentCalendarDate);
            noteListEl.innerHTML = '<p class="text-center text-gray">날짜를 선택해 기록을 확인하세요.</p>';
        });
    }

    // 노트 등록 FAB 버튼
    const noteFab = document.getElementById('noteFab');
    if (noteFab) {
        noteFab.addEventListener('click', () => {
            showNoteModal(null);
        });
    }

    // 노트 모달 저장 버튼
    const saveNoteBtn = document.getElementById('saveNoteBtn');
    if (saveNoteBtn) {
        saveNoteBtn.addEventListener('click', saveNote);
    }

    // 노트 모달 닫기 버튼
    const noteModalCloseBtn = document.getElementById('closeNoteModal');
    if (noteModalCloseBtn) {
        noteModalCloseBtn.addEventListener('click', () => closeModal(noteModal));
    }

    // 노트 모달 배경 클릭 시 닫기
    const noteModalEl = document.getElementById('noteModal');
    if (noteModalEl) {
        noteModalEl.addEventListener('click', (e) => {
            if (e.target.id === 'noteModal') closeModal(noteModal);
        });
    }

    // 노트 탭 필터링 바인딩
    if (noteTabs) {
        NOTE_TYPES.forEach(type => {
            let tab = document.querySelector(`.note-tab[data-type="${type}"]`);
            if (!tab) {
                tab = document.createElement('button');
                tab.className = 'note-tab';
                tab.textContent = type;
                tab.dataset.type = type;
                noteTabs.appendChild(tab);
            }

            if (type === '전체') tab.classList.add('active');

            tab.addEventListener('click', () => {
                currentNoteType = type;
                document.querySelectorAll('.note-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                renderNotes(); // 필터링된 목록 렌더링
            });
        });
    }
});