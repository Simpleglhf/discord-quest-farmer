(() => {
	"use strict";

	const APP_NAME = "Quest Farmer";
	const VERSION = "1.0.0";
	const AUTHOR = "SimpleG";
	const AUTHOR_URL = "https://fakecrime.bio/Simpleg";
	const AUTO_START = false;
	const VIDEO_STEP_SECONDS = 7;
	const ACTIVITY_INTERVAL_MS = 20 * 1000;
	const DESKTOP_ONLY_TASKS = ["PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP"];
	const ENROLL_LOCATION = 11;
	const ENROLL_SYNC_TIMEOUT_MS = 5000;

	const UI_ROUTE = "/quest-home";
	const UI_ANCHOR_HEADINGS = ["Verfügbare Quests", "Available Quests"];
	const UI_FALLBACK_DELAY_MS = 1500;
	const HIDE_DISCORD_QUESTS = true;
	const HIDE_DISCORD_PROMO = true;
	const FILTER_STORAGE_KEY = "orbFarmer.filters";

	const NAV_LABEL = APP_NAME;
	const NAV_SHOW_BADGE = true;
	const NAV_ORIGINAL_LABELS = ["Quests"];
	const TITLE_BAR_MAX_Y = 48;

	const TASK_LABELS = {
		WATCH_VIDEO: "Watch video",
		WATCH_VIDEO_ON_MOBILE: "Watch video (mobile)",
		PLAY_ON_DESKTOP: "Play",
		STREAM_ON_DESKTOP: "Stream",
		PLAY_ACTIVITY: "Activity",
	};
	const STATUS_LABELS = {
		available: "Not accepted",
		idle: "Ready",
		queued: "Queued",
		running: "Running",
		done: "Done",
		error: "Error",
		unsupported: "Not possible",
	};

	const log = (...args) => console.log(`%c[${APP_NAME}]`, "color: #5865F2; font-weight: bold", ...args);

	const randomPid = () => Math.floor(Math.random() * 30000) + 1000;

	const abortError = () => new DOMException("Aborted", "AbortError");
	const isAbort = err => err?.name === "AbortError";

	const sleep = (ms, signal) => new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(abortError());
		const onAbort = () => { clearTimeout(timer); reject(abortError()); };
		const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});

	function onceSync(signal, fn) {
		let ran = false;
		const run = () => {
			if (ran) return;
			ran = true;
			signal.removeEventListener("abort", run);
			fn();
		};
		signal.addEventListener("abort", run, { once: true });
		return run;
	}

	const toCamel = value => Array.isArray(value)
		? value.map(toCamel)
		: value && typeof value === "object"
			? Object.fromEntries(Object.entries(value).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), toCamel(v)]))
			: value;

	if (window.__orbFarmer) {
		log("Previous instance found – stopping it.");
		try { window.__orbFarmer.destroy(); } catch (err) { log("Could not destroy previous instance:", err); }
	}

	delete window.$;
	const wpRequire = webpackChunkdiscord_app.push([[Symbol()], {}, r => r]);
	webpackChunkdiscord_app.pop();

	function findModule(name, predicate, key) {
		const mod = Object.values(wpRequire.c).find(predicate);
		if (!mod) throw new Error(`[${APP_NAME}] Could not find ${name} – Discord probably changed its internals.`);
		return mod.exports[key];
	}

	const ApplicationStreamingStore = findModule("ApplicationStreamingStore", x => x?.exports?.A?.__proto__?.getStreamerActiveStreamMetadata, "A");
	const RunningGameStore = findModule("RunningGameStore", x => x?.exports?.Ay?.getRunningGames, "Ay");
	const QuestsStore = findModule("QuestsStore", x => x?.exports?.A?.__proto__?.getQuest, "A");
	const ChannelStore = findModule("ChannelStore", x => x?.exports?.A?.__proto__?.getAllThreadsForParent, "A");
	const GuildChannelStore = findModule("GuildChannelStore", x => x?.exports?.Ay?.getSFWDefaultChannel, "Ay");
	const FluxDispatcher = findModule("FluxDispatcher", x => x?.exports?.h?.__proto__?.flushWaitQueue, "h");
	const api = findModule("api", x => x?.exports?.Bo?.get, "Bo");

	const isApp = typeof DiscordNative !== "undefined";
	const getQuest = id => QuestsStore.getQuest?.(id) ?? QuestsStore.quests.get(id);

	function waitForHeartbeatProgress(quest, taskName, target, signal, report) {
		return new Promise((resolve, reject) => {
			const cleanup = () => {
				FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onHeartbeat);
				signal.removeEventListener("abort", onAbort);
			};
			const onHeartbeat = data => {
				if (data?.questId && data.questId !== quest.id) return;
				const progress = quest.config.configVersion === 1
					? data.userStatus.streamProgressSeconds
					: Math.floor(data.userStatus.progress[taskName].value);
				report({ progress });
				if (progress >= target) { cleanup(); resolve(); }
			};
			const onAbort = () => { cleanup(); reject(abortError()); };
			if (signal.aborted) return reject(abortError());
			FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onHeartbeat);
			signal.addEventListener("abort", onAbort, { once: true });
		});
	}

	async function runWatchVideo({ quest, target, progress }, signal, report) {
		let done = progress;
		let completed = false;
		report({ message: "Sending video progress" });

		while (done < target) {
			await sleep(Math.min(VIDEO_STEP_SECONDS, target - done) * 1000, signal);
			const timestamp = done + VIDEO_STEP_SECONDS;
			const res = await api.post({ url: `/quests/${quest.id}/video-progress`, body: { timestamp: Math.min(target, timestamp + Math.random()) } });
			completed = res.body.completed_at != null;
			done = Math.min(target, timestamp);
			report({ progress: done });
		}
		if (!completed) {
			await api.post({ url: `/quests/${quest.id}/video-progress`, body: { timestamp: target } });
		}
	}

	async function runPlayOnDesktop({ quest, applicationId, target }, signal, report) {
		const res = await api.get({ url: `/applications/public?application_ids=${applicationId}` });
		if (signal.aborted) throw abortError();
		const appData = res.body[0];
		const exeName = appData.executables?.find(x => x.os === "win32")?.name?.replace(">", "") ?? appData.name.replace(/[\/\\:*?"<>|]/g, "");
		const pid = randomPid();

		const fakeGame = {
			cmdLine: `C:\\Program Files\\${appData.name}\\${exeName}`,
			exeName,
			exePath: `c:/program files/${appData.name.toLowerCase()}/${exeName}`,
			hidden: false,
			isLauncher: false,
			id: applicationId,
			name: appData.name,
			pid,
			pidPath: [pid],
			processName: appData.name,
			start: Date.now(),
		};
		const realGetRunningGames = RunningGameStore.getRunningGames;
		const realGetGameForPID = RunningGameStore.getGameForPID;
		const realGames = realGetRunningGames.call(RunningGameStore);
		const fakeGames = [fakeGame];
		RunningGameStore.getRunningGames = () => fakeGames;
		RunningGameStore.getGameForPID = pid => fakeGames.find(x => x.pid === pid);
		FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: realGames, added: [fakeGame], games: fakeGames });
		report({ message: `Spoofed game: ${appData.name}` });

		const restore = onceSync(signal, () => {
			RunningGameStore.getRunningGames = realGetRunningGames;
			RunningGameStore.getGameForPID = realGetGameForPID;
			const games = realGetRunningGames.call(RunningGameStore);
			FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: [fakeGame], added: games, games });
		});
		try {
			await waitForHeartbeatProgress(quest, "PLAY_ON_DESKTOP", target, signal, report);
		} finally {
			restore();
		}
	}

	async function runStreamOnDesktop({ quest, applicationId, target }, signal, report) {
		const realFunc = ApplicationStreamingStore.getStreamerActiveStreamMetadata;
		const pid = randomPid();
		ApplicationStreamingStore.getStreamerActiveStreamMetadata = () => ({ id: applicationId, pid, sourceName: null });
		report({ message: "Stream any window in a voice channel with at least 1 other person" });

		const restore = onceSync(signal, () => { ApplicationStreamingStore.getStreamerActiveStreamMetadata = realFunc; });
		try {
			await waitForHeartbeatProgress(quest, "STREAM_ON_DESKTOP", target, signal, report);
		} finally {
			restore();
		}
	}

	async function runPlayActivity({ quest, target }, signal, report) {
		const channelId = ChannelStore.getSortedPrivateChannels()[0]?.id
			?? Object.values(GuildChannelStore.getAllGuilds()).find(x => x != null && x.VOCAL.length > 0)?.VOCAL[0].channel.id;
		if (!channelId) throw new Error("No DM or voice channel found for the activity heartbeat");
		const streamKey = `call:${channelId}:1`;
		report({ message: "Sending activity heartbeats" });

		while (true) {
			const res = await api.post({ url: `/quests/${quest.id}/heartbeat`, body: { stream_key: streamKey, terminal: false } });
			const progress = res.body.progress.PLAY_ACTIVITY.value;
			report({ progress });
			if (progress >= target) break;
			await sleep(ACTIVITY_INTERVAL_MS, signal);
		}
		await api.post({ url: `/quests/${quest.id}/heartbeat`, body: { stream_key: streamKey, terminal: true } });
	}

	const taskHandlers = {
		WATCH_VIDEO: runWatchVideo,
		WATCH_VIDEO_ON_MOBILE: runWatchVideo,
		PLAY_ON_DESKTOP: runPlayOnDesktop,
		STREAM_ON_DESKTOP: runStreamOnDesktop,
		PLAY_ACTIVITY: runPlayActivity,
	};
	const supportedTasks = Object.keys(taskHandlers);

	async function enrollQuest(quest, taskName, signal, report) {
		report({ message: "Accepting quest …" });
		const res = await api.post({ url: `/quests/${quest.id}/enroll`, body: { location: ENROLL_LOCATION } });
		if (signal.aborted) throw abortError();
		report({ enrolled: true });
		try {
			FluxDispatcher.dispatch({ type: "QUESTS_ENROLL_SUCCESS", questId: quest.id, enrolledQuestUserStatus: toCamel(res.body) });
		} catch (err) {
			console.warn(`[${APP_NAME}] Could not sync enrollment to Discord's store:`, err);
		}
		if (!DESKTOP_ONLY_TASKS.includes(taskName)) return;
		const until = Date.now() + ENROLL_SYNC_TIMEOUT_MS;
		while (!getQuest(quest.id)?.userStatus?.enrolledAt) {
			if (Date.now() > until) throw new Error("Accepted, but Discord hasn't picked it up yet – press Ctrl+R and paste the script again");
			await sleep(250, signal);
		}
	}

	const REWARD_KINDS = { orbs: "Orbs", collectible: "Decorations", ingame: "In-game", nitro: "Nitro", other: "Other" };

	function describeReward(quest) {
		const reward = quest.config.rewardsConfig?.rewards?.[0];
		const name = reward?.messages?.name ?? reward?.messages?.nameWithArticle ?? "";
		const orbs = reward?.orbQuantity ?? Number(/(\d[\d.,]*)\s*Orbs?/i.exec(name)?.[1]?.replace(/[.,]/g, "") ?? 0);
		if (orbs > 0 || reward?.type === 4) return { kind: "orbs", label: `${orbs} Orbs`, orbs };
		const kind = { 1: "ingame", 2: "ingame", 3: "collectible", 5: "nitro" }[reward?.type] ?? "other";
		return { kind, label: name, orbs: 0 };
	}

	const entries = new Map();
	const listeners = new Set();
	const queue = [];
	const lanes = { api: null, desktop: null };
	const STARTABLE = ["available", "idle", "error"];

	const getTaskConfig = quest => quest.config.taskConfig ?? quest.config.taskConfigV2;
	const laneOf = taskName => DESKTOP_ONLY_TASKS.includes(taskName) ? "desktop" : "api";
	const restingStatus = entry => entry.enrolled ? "idle" : "available";

	function emit(entry) {
		for (const fn of listeners) {
			try { fn(entry, getState()); } catch (err) { console.error(`[${APP_NAME}] listener failed:`, err); }
		}
	}

	function update(id, patch) {
		const entry = entries.get(id);
		if (!entry) return;
		Object.assign(entry, patch);
		emit(entry);
	}

	function getState() {
		return [...entries.values()].map(e => ({ ...e, reward: { ...e.reward } }));
	}

	function refreshQuests() {
		const seen = new Set();
		for (const quest of QuestsStore.quests.values()) {
			if (new Date(quest.config.expiresAt).getTime() <= Date.now()) continue;
			const tasks = getTaskConfig(quest)?.tasks ?? {};
			const taskKeys = Object.keys(tasks);
			if (taskKeys.length === 0) continue;
			seen.add(quest.id);

			const taskName = supportedTasks.find(x => tasks[x] != null) ?? taskKeys[0];
			const target = tasks[taskName].target ?? 0;
			const storeProgress = quest.userStatus?.progress?.[taskName]?.value ?? 0;
			const completed = !!quest.userStatus?.completedAt;
			const entry = entries.get(quest.id);
			const enrolled = !!quest.userStatus?.enrolledAt || !!entry?.enrolled;
			const claimed = !!quest.userStatus?.claimedAt;
			const info = {
				name: quest.config.messages?.questName ?? quest.config.messages?.gameTitle ?? quest.id,
				reward: describeReward(quest),
				expiresAt: quest.config.expiresAt,
				enrolled,
				claimed,
			};

			if (!entry) {
				let status = enrolled ? "idle" : "available", message = "";
				if (completed) status = "done";
				else if (!taskHandlers[taskName]) { status = "unsupported"; message = `Task type ${taskName} is not supported`; }
				else if (!isApp && DESKTOP_ONLY_TASKS.includes(taskName)) { status = "unsupported"; message = "Only works in the Discord desktop app"; }
				entries.set(quest.id, { id: quest.id, taskName, status, progress: completed ? target : storeProgress, target, message, ...info });
				emit(entries.get(quest.id));
				continue;
			}

			const patch = { ...info };
			if (completed && !["done", "running"].includes(entry.status)) Object.assign(patch, { status: "done", progress: entry.target, message: "" });
			else if (entry.status === "available" && enrolled) patch.status = "idle";
			if (storeProgress > entry.progress && entry.status !== "done") patch.progress = storeProgress;
			if (Object.entries(patch).some(([k, v]) => k === "reward" ? v.label !== entry.reward.label : entry[k] !== v)) update(quest.id, patch);
		}
		for (const [id, entry] of entries) {
			if (!seen.has(id) && !["running", "queued"].includes(entry.status)) entries.delete(id);
		}
	}

	async function runQuest(id, controller) {
		const entry = entries.get(id);
		const report = patch => { if (!controller.signal.aborted) update(id, patch); };
		if (!entry.enrolled) await enrollQuest(getQuest(id), entry.taskName, controller.signal, report);

		const quest = getQuest(id);
		const taskData = getTaskConfig(quest).tasks[entry.taskName];
		const ctx = {
			quest,
			name: entry.name,
			applicationId: quest.config.application?.id ?? taskData.applications?.[0]?.id,
			target: taskData.target,
			progress: Math.max(entry.progress, quest.userStatus?.progress?.[entry.taskName]?.value ?? 0),
		};
		await taskHandlers[entry.taskName](ctx, controller.signal, report);
	}

	async function runInLane(lane, id) {
		const controller = new AbortController();
		lanes[lane] = { id, controller };
		update(id, { status: "running", message: "" });

		try {
			await runQuest(id, controller);
			const entry = entries.get(id);
			update(id, { status: "done", progress: entry?.target ?? 0, message: entry?.claimed ? "" : "Claim the reward in Discord" });
		} catch (err) {
			const entry = entries.get(id);
			if (isAbort(err)) update(id, { status: entry ? restingStatus(entry) : "idle", message: "Stopped" });
			else {
				console.error(`[${APP_NAME}] Quest failed:`, err);
				update(id, { status: "error", message: err?.message ?? String(err) });
			}
		} finally {
			lanes[lane] = null;
		}
		processQueue();
	}

	function processQueue() {
		for (const lane of Object.keys(lanes)) {
			if (lanes[lane]) continue;
			const index = queue.findIndex(id => laneOf(entries.get(id)?.taskName) === lane);
			if (index === -1) continue;
			const [id] = queue.splice(index, 1);
			runInLane(lane, id);
		}
	}

	function start(id) {
		const entry = entries.get(id);
		if (!entry || !STARTABLE.includes(entry.status)) return false;
		queue.push(id);
		update(id, { status: "queued", message: "" });
		processQueue();
		return true;
	}

	function startAll(ids) {
		refreshQuests();
		let started = 0;
		for (const id of ids ?? [...entries.keys()]) if (start(id)) started++;
		return started;
	}

	function stop(id) {
		const index = queue.indexOf(id);
		if (index !== -1) {
			queue.splice(index, 1);
			const entry = entries.get(id);
			if (entry) update(id, { status: restingStatus(entry), message: "" });
			return true;
		}
		const lane = Object.values(lanes).find(l => l?.id === id);
		if (lane) {
			lane.controller.abort();
			return true;
		}
		return false;
	}

	function stopAll() {
		for (const id of [...queue]) stop(id);
		for (const lane of Object.values(lanes)) lane?.controller.abort();
	}

	function on(fn) {
		listeners.add(fn);
		return () => listeners.delete(fn);
	}

	let refreshTimer = null;
	const onStoreChange = () => {
		clearTimeout(refreshTimer);
		refreshTimer = setTimeout(refreshQuests, 250);
	};
	QuestsStore.addChangeListener?.(onStoreChange);

	const lastLogged = new Map();
	on(entry => {
		const line = `${entry.name} [${entry.taskName}] ${entry.status} ${Math.floor(entry.progress)}/${entry.target}${entry.message ? ` – ${entry.message}` : ""}`;
		if (lastLogged.get(entry.id) === line) return;
		lastLogged.set(entry.id, line);
		log(line);
	});

	const PANEL_ID = "orb-farmer-panel";
	const STYLE_ID = "orb-farmer-style";
	const CARD_BTN_CLASS = "of-card-btn";
	const STATUS_ORDER = ["running", "queued", "idle", "available", "error", "done", "unsupported"];
	const UI_BATCH_MS = 50;
	const CARD_SCAN_INTERVAL_MS = 1000;

	const TASK_GROUPS = { WATCH_VIDEO: "video", WATCH_VIDEO_ON_MOBILE: "video", PLAY_ON_DESKTOP: "play", STREAM_ON_DESKTOP: "stream", PLAY_ACTIVITY: "activity" };
	const STATUS_GROUPS = { available: "open", idle: "open", error: "open", queued: "active", running: "active", done: "done", unsupported: "unsupported" };
	const FILTERS = {
		reward: { label: "Reward", options: { all: "All", ...REWARD_KINDS }, value: e => e.reward.kind },
		task: { label: "Task", options: { all: "All", video: "Video", play: "Play", stream: "Stream", activity: "Activity" }, value: e => TASK_GROUPS[e.taskName] ?? "other" },
		status: { label: "Status", options: { all: "All", open: "Open", active: "Active", done: "Done", unsupported: "Not possible" }, value: e => STATUS_GROUPS[e.status] },
	};

	const CSS = `
#${PANEL_ID} {
	--of-bg: var(--background-floating, var(--background-secondary, #2b2d31));
	--of-row: var(--background-modifier-selected, var(--background-secondary-alt, #313338));
	--of-row-hover: var(--background-modifier-hover, #3f4248);
	--of-border: var(--border-subtle, rgba(255, 255, 255, 0.06));
	--of-border-strong: var(--border-default, rgba(255, 255, 255, 0.1));
	--of-text: var(--text-normal, #dbdee1);
	--of-strong: var(--header-primary, #f2f3f5);
	--of-muted: var(--text-muted, #949ba4);
	--of-brand: var(--brand-500, #5865f2);
	--of-brand-hover: var(--brand-560, #4752c4);
	--of-brand-bg: rgba(88, 101, 242, 0.15);
	--of-ok: var(--status-positive, #23a55a);
	--of-ok-bg: rgba(35, 165, 90, 0.15);
	--of-err: var(--status-danger, #f23f43);
	--of-warn: var(--status-warning, #f0b232);
	--of-purple: #a855f7;
	box-sizing: border-box;
	width: 100%;
	margin: 0 0 24px;
	border: 1px solid var(--of-border-strong);
	border-radius: 16px;
	background: var(--of-bg);
	color: var(--of-text);
	font-family: var(--font-primary, inherit);
	font-size: 14px;
	line-height: 1.4;
	overflow: hidden;
}
#${PANEL_ID}.of-floating {
	position: fixed;
	right: 24px;
	bottom: 24px;
	z-index: 1000;
	width: 520px;
	max-width: calc(100vw - 48px);
	max-height: 75vh;
	overflow: auto;
	box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
}
#${PANEL_ID} * { box-sizing: border-box; }
#${PANEL_ID} a { color: var(--of-brand); text-decoration: none; }
#${PANEL_ID} a:hover { text-decoration: underline; }

#${PANEL_ID} .of-header {
	display: flex;
	align-items: center;
	gap: 12px;
	flex-wrap: wrap;
	padding: 16px 20px;
	border-bottom: 1px solid var(--of-border);
	background: linear-gradient(135deg, var(--of-brand-bg) 0%, transparent 60%);
}
#${PANEL_ID} .of-title { display: flex; align-items: center; gap: 10px; color: var(--of-strong); font-size: 18px; font-weight: 700; }
#${PANEL_ID} .of-title-icon { display: flex; color: var(--of-brand); filter: drop-shadow(0 0 8px var(--of-brand)); }
#${PANEL_ID} .of-byline { color: var(--of-muted); font-size: 12px; font-weight: 500; }
#${PANEL_ID} .of-actions { display: flex; gap: 8px; margin-left: auto; }
#${PANEL_ID} .of-btn {
	height: 34px;
	padding: 0 16px;
	border: none;
	border-radius: 8px;
	font-family: inherit;
	font-size: 13px;
	font-weight: 600;
	white-space: nowrap;
	cursor: pointer;
	transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}
#${PANEL_ID} .of-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3); }
#${PANEL_ID} .of-btn:active:not(:disabled) { transform: none; }
#${PANEL_ID} .of-btn:disabled { opacity: 0.4; cursor: not-allowed; }
#${PANEL_ID} .of-btn-brand { background: linear-gradient(135deg, var(--of-brand) 0%, var(--of-brand-hover) 100%); color: #fff; }
#${PANEL_ID} .of-btn-secondary { background: var(--of-row); color: var(--of-text); border: 1px solid var(--of-border); }
#${PANEL_ID} .of-btn-secondary:hover:not(:disabled) { background: var(--of-row-hover); }

#${PANEL_ID} .of-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; padding: 16px 20px; }
#${PANEL_ID} .of-tile {
	position: relative;
	overflow: hidden;
	padding: 14px 16px 14px 18px;
	border: 1px solid var(--of-border);
	border-radius: 12px;
	background: var(--of-row);
}
#${PANEL_ID} .of-tile::before { content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 3px; background: var(--of-accent); }
#${PANEL_ID} .of-tile::after {
	content: "";
	position: absolute;
	top: -40px;
	right: -40px;
	width: 100px;
	height: 100px;
	border-radius: 50%;
	background: var(--of-accent);
	opacity: 0.08;
}
#${PANEL_ID} .of-accent-brand { --of-accent: var(--of-brand); }
#${PANEL_ID} .of-accent-ok { --of-accent: var(--of-ok); }
#${PANEL_ID} .of-accent-warn { --of-accent: var(--of-warn); }
#${PANEL_ID} .of-accent-purple { --of-accent: var(--of-purple); }
#${PANEL_ID} .of-tile-head { display: flex; align-items: center; gap: 6px; color: var(--of-muted); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
#${PANEL_ID} .of-tile-icon { color: var(--of-accent); font-size: 13px; }
#${PANEL_ID} .of-tile-value { margin-top: 6px; color: var(--of-strong); font-size: 24px; font-weight: 800; line-height: 1.1; font-variant-numeric: tabular-nums; }
#${PANEL_ID} .of-tile-sub { margin-top: 3px; overflow: hidden; color: var(--of-muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
#${PANEL_ID} .of-tile .of-bar { margin-top: 9px; }
#${PANEL_ID} .of-tile .of-fill { background: linear-gradient(90deg, var(--of-accent), var(--of-brand)); }

#${PANEL_ID} .of-toolbar {
	display: flex;
	align-items: flex-end;
	justify-content: space-between;
	gap: 12px;
	flex-wrap: wrap;
	padding: 0 20px;
	border-bottom: 1px solid var(--of-border);
}
#${PANEL_ID} .of-tabs { display: flex; gap: 20px; flex-wrap: wrap; }
#${PANEL_ID} .of-tab {
	margin-bottom: -1px;
	padding: 10px 0;
	border: none;
	border-bottom: 2px solid transparent;
	background: none;
	color: var(--of-muted);
	font-family: inherit;
	font-size: 14px;
	font-weight: 500;
	cursor: pointer;
	transition: color 0.15s ease, border-color 0.15s ease;
}
#${PANEL_ID} .of-tab:hover { color: var(--of-text); }
#${PANEL_ID} .of-tab.of-active { border-bottom-color: var(--of-brand); color: var(--of-strong); }
#${PANEL_ID} .of-tab-count { margin-left: 6px; padding: 1px 6px; border-radius: 8px; background: var(--of-row); color: var(--of-muted); font-size: 11px; font-weight: 600; }
#${PANEL_ID} .of-tab.of-active .of-tab-count { background: var(--of-brand-bg); color: var(--of-brand); }
#${PANEL_ID} .of-selects { display: flex; gap: 8px; padding: 8px 0; }
#${PANEL_ID} .of-select {
	height: 30px;
	padding: 0 28px 0 10px;
	border: 1px solid var(--of-border-strong);
	border-radius: 8px;
	background-color: var(--of-row);
	background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23949ba4' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
	background-position: right 10px center;
	background-repeat: no-repeat;
	color: var(--of-text);
	font-family: inherit;
	font-size: 13px;
	appearance: none;
	cursor: pointer;
}
#${PANEL_ID} .of-select:hover { border-color: var(--of-brand); }
#${PANEL_ID} .of-select.of-active { border-color: var(--of-brand); color: var(--of-strong); }
#${PANEL_ID} .of-select option { background: #2b2d31; color: #dbdee1; }

#${PANEL_ID} .of-list { display: flex; flex-direction: column; }
#${PANEL_ID} .of-row {
	display: grid;
	grid-template-columns: 40px minmax(0, 1fr) 120px 104px;
	align-items: center;
	gap: 14px;
	padding: 12px 20px;
	border-bottom: 1px solid var(--of-border);
	transition: background 0.15s ease, opacity 0.15s ease;
}
#${PANEL_ID} .of-row:last-child { border-bottom: none; }
#${PANEL_ID} .of-row:hover { background: var(--of-row); }
#${PANEL_ID} .of-row.of-done, #${PANEL_ID} .of-row.of-unsupported { opacity: 0.65; }
#${PANEL_ID} .of-row.of-done:hover, #${PANEL_ID} .of-row.of-unsupported:hover { opacity: 1; }
#${PANEL_ID} .of-ring { position: relative; width: 40px; height: 40px; color: var(--of-muted); }
#${PANEL_ID} .of-ring svg { display: block; transform: rotate(-90deg); }
#${PANEL_ID} .of-ring-track { stroke: var(--of-border-strong); }
#${PANEL_ID} .of-ring-fill { stroke: currentColor; transition: stroke-dashoffset 0.5s ease; }
#${PANEL_ID} .of-ring-label {
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	color: var(--of-strong);
	font-size: 10px;
	font-weight: 700;
	font-variant-numeric: tabular-nums;
}
#${PANEL_ID} .of-running .of-ring, #${PANEL_ID} .of-queued .of-ring { color: var(--of-brand); }
#${PANEL_ID} .of-running .of-ring { filter: drop-shadow(0 0 6px rgba(88, 101, 242, 0.5)); }
#${PANEL_ID} .of-done .of-ring { color: var(--of-ok); }
#${PANEL_ID} .of-error .of-ring { color: var(--of-err); }
#${PANEL_ID} .of-unsupported .of-ring { color: var(--of-warn); }
#${PANEL_ID} .of-info { min-width: 0; }
#${PANEL_ID} .of-name-line { display: flex; align-items: center; gap: 8px; min-width: 0; margin-bottom: 3px; }
#${PANEL_ID} .of-name { overflow: hidden; color: var(--of-strong); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
#${PANEL_ID} .of-reward {
	flex-shrink: 0;
	max-width: 50%;
	overflow: hidden;
	padding: 2px 8px;
	border-radius: 10px;
	background: var(--of-row);
	color: var(--of-text);
	font-size: 11px;
	font-weight: 700;
	text-overflow: ellipsis;
	white-space: nowrap;
}
#${PANEL_ID} .of-reward-orbs { background: var(--of-brand-bg); color: #8f98ff; }
#${PANEL_ID} .of-reward-collectible { background: var(--of-ok-bg); color: var(--of-ok); }
#${PANEL_ID} .of-reward-nitro { background: rgba(168, 85, 247, 0.15); color: var(--of-purple); }
#${PANEL_ID} .of-meta { overflow: hidden; color: var(--of-muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
#${PANEL_ID} .of-status { font-weight: 600; }
#${PANEL_ID} .of-running .of-status, #${PANEL_ID} .of-queued .of-status { color: var(--of-brand); }
#${PANEL_ID} .of-done .of-status { color: var(--of-ok); }
#${PANEL_ID} .of-error .of-status { color: var(--of-err); }
#${PANEL_ID} .of-unsupported .of-status { color: var(--of-warn); }
#${PANEL_ID} .of-progress-text { text-align: right; font-variant-numeric: tabular-nums; }
#${PANEL_ID} .of-pct { color: var(--of-strong); font-size: 15px; font-weight: 700; }
#${PANEL_ID} .of-eta { color: var(--of-muted); font-size: 11px; }
#${PANEL_ID} .of-action { display: flex; justify-content: flex-end; }
#${PANEL_ID} .of-action .of-btn { width: 100%; padding: 0 10px; }
#${PANEL_ID} .of-claim { color: var(--of-ok); font-size: 11px; font-weight: 600; text-align: right; }
#${PANEL_ID} .of-empty { padding: 32px 20px; color: var(--of-muted); font-size: 13px; text-align: center; }

#${PANEL_ID} .of-footer {
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 12px;
	flex-wrap: wrap;
	padding: 12px 20px;
	border-top: 1px solid var(--of-border);
	background: var(--of-row);
	color: var(--of-muted);
	font-size: 11px;
}
#${PANEL_ID} .of-watermark { color: var(--of-text); font-weight: 600; }
#${PANEL_ID} .of-link { padding: 0; border: none; background: none; color: var(--of-muted); font-family: inherit; font-size: 11px; cursor: pointer; }
#${PANEL_ID} .of-link:hover { color: var(--of-err); }

@media (max-width: 860px) {
	#${PANEL_ID} .of-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
#${PANEL_ID}.of-floating .of-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
#${PANEL_ID}.of-floating .of-row { grid-template-columns: 40px minmax(0, 1fr) 96px; }
#${PANEL_ID}.of-floating .of-progress-text { display: none; }
@media (max-width: 640px) {
	#${PANEL_ID} .of-row { grid-template-columns: 40px minmax(0, 1fr) 96px; }
	#${PANEL_ID} .of-progress-text { display: none; }
	#${PANEL_ID} .of-actions { width: 100%; margin-left: 0; }
	#${PANEL_ID} .of-actions .of-btn { flex: 1; }
}

.${CARD_BTN_CLASS} {
	position: absolute;
	top: 10px;
	left: 50%;
	z-index: 5;
	transform: translateX(-50%);
	height: 26px;
	padding: 0 12px;
	border: none;
	border-radius: 13px;
	background: linear-gradient(135deg, var(--brand-500, #5865f2) 0%, var(--brand-560, #4752c4) 100%);
	color: #fff;
	font-family: var(--font-primary, inherit);
	font-size: 12px;
	font-weight: 600;
	white-space: nowrap;
	cursor: pointer;
	box-shadow: 0 4px 12px rgba(88, 101, 242, 0.4);
	transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.${CARD_BTN_CLASS}:hover { transform: translateX(-50%) translateY(-2px); box-shadow: 0 6px 16px rgba(88, 101, 242, 0.5); }
.${CARD_BTN_CLASS}.of-card-running, .${CARD_BTN_CLASS}.of-card-queued {
	background: rgba(17, 18, 20, 0.85);
	color: #dbdee1;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}
.${CARD_BTN_CLASS}.of-card-running:hover, .${CARD_BTN_CLASS}.of-card-queued:hover { transform: translateX(-50%); }
.${CARD_BTN_CLASS}.of-card-done { background: var(--status-positive, #23a55a); box-shadow: 0 2px 8px rgba(35, 165, 90, 0.4); cursor: default; }
.${CARD_BTN_CLASS}.of-card-done:hover { transform: translateX(-50%); }
.${CARD_BTN_CLASS}.of-card-error { background: var(--status-danger, #f23f43); }
.${CARD_BTN_CLASS}.of-card-unsupported { display: none; }

.of-hide, [data-of-nav-orig], [data-of-nav-orig-icon], [data-of-hidden] { display: none !important; }
a[data-of-nav] { position: relative; }
.of-nav-svg { flex-shrink: 0; color: inherit; }
.of-nav-badge {
	position: absolute;
	top: 50%;
	right: 8px;
	min-width: 16px;
	height: 16px;
	padding: 0 5px;
	border-radius: 8px;
	background: var(--brand-500, #5865f2);
	color: #fff;
	font-family: var(--font-primary, inherit);
	font-size: 11px;
	font-weight: 700;
	line-height: 16px;
	text-align: center;
	font-variant-numeric: tabular-nums;
	transform: translateY(-50%);
	pointer-events: none;
}
.of-nav-badge.of-badge-open { background: var(--background-modifier-accent, #4e5058); }
.of-nav-badge.of-badge-done { background: var(--status-positive, #23a55a); }`;

	const ORB_ICON = `<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 6.5l1.6 3.9 3.9 1.6-3.9 1.6L12 17.5l-1.6-3.9L6.5 12l3.9-1.6z" fill="currentColor"/></svg>`;

	function h(tag, props = {}, ...children) {
		const el = document.createElement(tag);
		for (const [key, value] of Object.entries(props)) {
			if (key.startsWith("on")) el.addEventListener(key.slice(2).toLowerCase(), value);
			else if (key === "html") el.innerHTML = value;
			else if (value === true) el.setAttribute(key, "");
			else if (value !== false && value != null) el.setAttribute(key, value);
		}
		for (const child of children.flat()) {
			if (child != null && child !== false && child !== "") el.append(child);
		}
		return el;
	}

	const button = (label, variant, onClick, disabled = false) =>
		h("button", { type: "button", class: `of-btn of-btn-${variant}`, onClick, disabled }, label);

	const formatNumber = n => n.toLocaleString("en-US");
	const formatDate = iso => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
	const fraction = e => e.target ? Math.min(1, e.progress / e.target) : 0;
	const percent = e => Math.round(fraction(e) * 100);

	const ui = {
		panel: null,
		observer: null,
		renderQueued: false,
		mountQueued: false,
		missingSince: 0,
		lastAnchorTry: 0,
		fallbackTimer: null,
		lastCardScan: 0,
		cardScanTimer: null,
		scannedNodes: new WeakSet(),
		titleNode: null,
		titleSearches: 0,
		lastTitleSearch: 0,
		docTitle: null,
		unsubscribe: null,
		filters: loadFilters(),
	};

	function loadFilters() {
		const defaults = { reward: "all", task: "all", status: "all" };
		try { return { ...defaults, ...JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY) ?? "{}") }; } catch { return defaults; }
	}

	function setFilter(key, value) {
		ui.filters[key] = value;
		try { localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(ui.filters)); } catch {}
		scheduleRender();
	}

	const matchesFilters = (e, skipKey) => Object.entries(FILTERS).every(([key, f]) =>
		key === skipKey || ui.filters[key] === "all" || f.value(e) === ui.filters[key]);

	function filterOptions(state, key) {
		const f = FILTERS[key];
		const pool = state.filter(e => matchesFilters(e, key));
		return Object.entries(f.options)
			.map(([value, label]) => ({ value, label, count: value === "all" ? pool.length : pool.filter(e => f.value(e) === value).length }))
			.filter(o => o.value === "all" || o.count > 0 || ui.filters[key] === o.value);
	}

	function computeStats(visible) {
		const relevant = visible.filter(e => e.status !== "unsupported");
		const done = relevant.filter(e => e.status === "done");
		return {
			total: relevant.length,
			done: done.length,
			running: relevant.filter(e => e.status === "running").length,
			queued: relevant.filter(e => e.status === "queued").length,
			pct: relevant.length ? Math.round((relevant.reduce((sum, e) => sum + fraction(e), 0) / relevant.length) * 100) : 0,
			orbsTotal: relevant.reduce((sum, e) => sum + e.reward.orbs, 0),
			orbsDone: done.reduce((sum, e) => sum + e.reward.orbs, 0),
		};
	}

	const tile = (accent, icon, label, value, sub) =>
		h("div", { class: `of-tile of-accent-${accent}` },
			h("div", { class: "of-tile-head" }, h("span", { class: "of-tile-icon" }, icon), label),
			h("div", { class: "of-tile-value" }, value),
			sub);

	function renderStats(s) {
		const sub = text => h("div", { class: "of-tile-sub" }, text);
		return h("div", { class: "of-stats" },
			tile("brand", "◆", "Orbs", formatNumber(s.orbsDone),
				sub(s.orbsTotal ? `of ${formatNumber(s.orbsTotal)} available` : "no Orb quests")),
			tile("ok", "✓", "Done", `${s.done} / ${s.total}`, sub("quests completed")),
			tile("warn", "⚡", "Active", String(s.running),
				sub(s.queued ? `${s.queued} queued` : s.running ? "running now" : "nothing active")),
			tile("purple", "◔", "Overall", `${s.pct}%`,
				h("div", { class: "of-bar" }, h("div", { class: "of-fill", style: `width: ${s.pct}%` }))));
	}

	function renderToolbar(state) {
		const tabs = filterOptions(state, "reward").map(o =>
			h("button", {
				type: "button",
				class: `of-tab${ui.filters.reward === o.value ? " of-active" : ""}`,
				onClick: () => setFilter("reward", o.value),
			}, o.label, h("span", { class: "of-tab-count" }, String(o.count))));

		const select = (key, allLabel) => h("select", {
			class: `of-select${ui.filters[key] !== "all" ? " of-active" : ""}`,
			title: FILTERS[key].label,
			onChange: event => setFilter(key, event.target.value),
		}, filterOptions(state, key).map(o =>
			h("option", { value: o.value, selected: ui.filters[key] === o.value },
				`${o.value === "all" ? allLabel : o.label} (${o.count})`)));

		return h("div", { class: "of-toolbar" },
			h("div", { class: "of-tabs" }, tabs),
			h("div", { class: "of-selects" }, select("status", "Status: all"), select("task", "Task: all")));
	}

	function renderRing(e) {
		const r = 16;
		const c = 2 * Math.PI * r;
		const label = e.status === "done" ? "✓" : e.status === "unsupported" ? "!" : e.status === "error" ? "✕" : String(percent(e));
		return h("div", { class: "of-ring" },
			h("span", {
				html: `<svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">`
					+ `<circle class="of-ring-track" cx="20" cy="20" r="${r}" fill="none" stroke-width="4"/>`
					+ `<circle class="of-ring-fill" cx="20" cy="20" r="${r}" fill="none" stroke-width="4" stroke-linecap="round"`
					+ ` stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - fraction(e))).toFixed(2)}"/></svg>`,
			}),
			h("span", { class: "of-ring-label" }, label));
	}

	function rowAction(e) {
		if (e.status === "available") return button("Farm", "brand", () => start(e.id));
		if (e.status === "idle") return button("Start", "brand", () => start(e.id));
		if (e.status === "error") return button("Retry", "brand", () => start(e.id));
		if (e.status === "running" || e.status === "queued") return button("Stop", "secondary", () => stop(e.id));
		if (e.status === "done") return h("div", { class: "of-claim" }, e.claimed ? "✓ Claimed" : "Claim in Discord");
		return null;
	}

	function renderRow(e) {
		const remaining = Math.max(0, e.target - e.progress);
		const eta = e.status === "running" && remaining > 0
			? `~${Math.ceil(remaining / 60)} min left`
			: `${Math.floor(e.progress)} / ${e.target} s`;
		return h("div", { class: `of-row of-${e.status}` },
			renderRing(e),
			h("div", { class: "of-info" },
				h("div", { class: "of-name-line" },
					h("span", { class: "of-name", title: e.name }, e.name),
					e.reward.label ? h("span", { class: `of-reward of-reward-${e.reward.kind}`, title: e.reward.label }, e.reward.label) : null),
				h("div", { class: "of-meta", title: e.message || null },
					`${TASK_LABELS[e.taskName] ?? e.taskName} · `,
					h("span", { class: "of-status" }, STATUS_LABELS[e.status] ?? e.status),
					e.message ? ` · ${e.message}` : ` · ends ${formatDate(e.expiresAt)}`)),
			h("div", { class: "of-progress-text" },
				h("div", { class: "of-pct" }, `${percent(e)}%`),
				h("div", { class: "of-eta" }, eta)),
			h("div", { class: "of-action" }, rowAction(e)));
	}

	function renderPanel(panel) {
		const state = getState().sort((a, b) =>
			STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || new Date(a.expiresAt) - new Date(b.expiresAt));
		const visible = state.filter(e => matchesFilters(e));
		const startable = visible.filter(e => STARTABLE.includes(e.status));
		const active = state.filter(e => e.status === "running" || e.status === "queued").length;
		const filtered = Object.values(ui.filters).some(v => v !== "all");

		panel.replaceChildren(
			h("div", { class: "of-header" },
				h("div", { class: "of-title" },
					h("span", { class: "of-title-icon", html: ORB_ICON }),
					APP_NAME,
					h("a", { class: "of-byline", href: AUTHOR_URL, target: "_blank", rel: "noopener noreferrer" }, `by ${AUTHOR}`)),
				h("div", { class: "of-actions" },
					button(`▶ Farm ${filtered ? "filtered" : "all"} (${startable.length})`, "brand", () => startAll(startable.map(e => e.id)), startable.length === 0),
					button("■ Stop all", "secondary", stopAll, active === 0))),
			renderStats(computeStats(visible)),
			renderToolbar(state),
			visible.length
				? h("div", { class: "of-list" }, visible.map(renderRow))
				: h("div", { class: "of-empty" }, state.length ? "No quests match this filter." : "No quests found."),
			h("div", { class: "of-footer" },
				h("span", {},
					h("span", { class: "of-watermark" }, `Build by ${AUTHOR}`),
					" · ",
					h("a", { href: AUTHOR_URL, target: "_blank", rel: "noopener noreferrer" }, AUTHOR_URL.replace(/^https?:\/\//, "")),
					` · v${VERSION}${isApp ? "" : " · Browser: video and activity quests only"}`),
				h("button", { type: "button", class: "of-link", onClick: destroy, title: `Stops everything and removes ${APP_NAME}` }, "Remove")));

		renderCardButtons(state);
	}

	function decorateNav() {
		for (const link of document.querySelectorAll(`a[href="${UI_ROUTE}"]`)) {
			if (ui.panel?.contains(link)) continue;

			let label = link.querySelector("[data-of-nav-orig]");
			if (!label) {
				const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
				for (let node = walker.nextNode(); node; node = walker.nextNode()) {
					if (NAV_ORIGINAL_LABELS.includes(node.nodeValue.trim()) && !node.parentElement.closest(".of-nav-label")) {
						label = node.parentElement;
						label.dataset.ofNavOrig = "";
						break;
					}
				}
			}
			if (!label) continue;
			let changed = false;
			if (!link.hasAttribute("data-of-nav")) { link.dataset.ofNav = ""; changed = true; }
			if (!link.querySelector(".of-nav-label")) {
				const ours = label.cloneNode(false);
				ours.removeAttribute("data-of-nav-orig");
				ours.classList.add("of-nav-label");
				ours.textContent = NAV_LABEL;
				label.after(ours);
				changed = true;
			}

			let icon = link.querySelector("[data-of-nav-orig-icon]") ?? link.querySelector("svg:not(.of-nav-svg)");
			if (icon) {
				icon.dataset.ofNavOrigIcon = "";
				if (!link.querySelector(".of-nav-svg")) {
					const ours = h("span", { html: ORB_ICON }).firstElementChild;
					ours.setAttribute("width", icon.getAttribute("width") ?? "20");
					ours.setAttribute("height", icon.getAttribute("height") ?? "20");
					ours.setAttribute("class", `${icon.getAttribute("class") ?? ""} of-nav-svg`.trim());
					icon.after(ours);
					changed = true;
				}
			}

			if (NAV_SHOW_BADGE && !link.querySelector(".of-nav-badge")) {
				link.append(h("span", { class: "of-nav-badge" }));
				changed = true;
			}
			if (changed) renderNav(getState());
		}
	}

	function renderNav(state) {
		const running = state.filter(e => e.status === "running");
		const queued = state.filter(e => e.status === "queued").length;
		const startable = state.filter(e => STARTABLE.includes(e.status)).length;
		const allDone = state.length > 0 && state.every(e => e.status === "done" || e.status === "unsupported");
		let text = "", kind = "", title = "";
		if (running.length) {
			const pct = Math.round(running.reduce((sum, e) => sum + fraction(e), 0) / running.length * 100);
			text = running.length > 1 ? `${running.length} · ${pct}%` : `${pct}%`;
			kind = "of-badge-active";
			title = `Running: ${running.map(e => `${e.name} (${percent(e)}%)`).join(", ")}${queued ? ` · ${queued} queued` : ""}`;
		} else if (queued) {
			text = String(queued);
			kind = "of-badge-active";
			title = `${queued} quests queued`;
		} else if (startable) {
			text = String(startable);
			kind = "of-badge-open";
			title = `${startable} quests can be farmed`;
		} else if (allDone) {
			text = "✓";
			kind = "of-badge-done";
			title = "All quests done";
		}
		for (const badge of document.querySelectorAll(".of-nav-badge")) {
			const className = `of-nav-badge ${kind}${text ? "" : " of-hide"}`.trim();
			if (badge.className !== className) badge.className = className;
			if (badge.textContent !== text) badge.textContent = text;
			badge.title = title;
		}
	}

	function restoreNav() {
		document.querySelectorAll(".of-nav-label, .of-nav-svg, .of-nav-badge").forEach(el => el.remove());
		document.querySelectorAll("[data-of-nav-orig], [data-of-nav-orig-icon]").forEach(el => {
			el.removeAttribute("data-of-nav-orig");
			el.removeAttribute("data-of-nav-orig-icon");
		});
		document.querySelectorAll("[data-of-nav]").forEach(el => el.removeAttribute("data-of-nav"));
	}

	function decorateTitle() {
		const onRoute = location.pathname.startsWith(UI_ROUTE);

		if (onRoute) {
			const original = NAV_ORIGINAL_LABELS.find(l => document.title?.includes(l));
			if (original && !document.title.includes(NAV_LABEL)) {
				const ours = document.title.replace(original, NAV_LABEL);
				ui.docTitle = { original: document.title, ours };
				document.title = ours;
			}
		} else if (ui.docTitle) {
			if (document.title === ui.docTitle.ours) document.title = ui.docTitle.original;
			ui.docTitle = null;
		}

		const t = ui.titleNode;
		if (!onRoute) {
			if (t?.node.isConnected && t.node.nodeValue === NAV_LABEL) t.node.nodeValue = t.original;
			ui.titleNode = null;
			ui.titleSearches = 0;
			return;
		}
		if (t?.node.isConnected) {
			if (t.node.nodeValue !== NAV_LABEL && NAV_ORIGINAL_LABELS.includes(t.node.nodeValue.trim())) t.node.nodeValue = NAV_LABEL;
			return;
		}
		if (ui.titleSearches >= 20 || Date.now() - ui.lastTitleSearch < 1000) return;
		ui.lastTitleSearch = Date.now();
		ui.titleSearches++;
		const node = findTitleTextNode();
		if (node) {
			ui.titleNode = { node, original: node.nodeValue };
			node.nodeValue = NAV_LABEL;
		}
	}

	function findTitleTextNode() {
		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
			acceptNode: n => NAV_ORIGINAL_LABELS.includes(n.nodeValue.trim()) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
		});
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const el = node.parentElement;
			if (!el || el.closest("a, button, [role='tab'], [role='button']") || ui.panel?.contains(el)) continue;
			const rect = el.getBoundingClientRect();
			if (rect.height > 0 && rect.top >= 0 && rect.bottom <= TITLE_BAR_MAX_Y) return node;
		}
		return null;
	}

	function restoreTitle() {
		const t = ui.titleNode;
		if (t?.node.isConnected && t.node.nodeValue === NAV_LABEL) t.node.nodeValue = t.original;
		ui.titleNode = null;
		if (ui.docTitle && document.title === ui.docTitle.ours) document.title = ui.docTitle.original;
		ui.docTitle = null;
	}

	function questIdFromElement(el) {
		const key = Object.keys(el).find(k => k.startsWith("__reactFiber$"));
		let fiber = key ? el[key].return : null;
		for (let i = 0; fiber && i < 8 && typeof fiber.type !== "string"; i++, fiber = fiber.return) {
			const id = fiber.memoizedProps?.quest?.id;
			if (id) return id;
		}
		return null;
	}

	function scanCards() {
		ui.lastCardScan = Date.now();
		const container = ui.panel?.parentElement;
		if (!container || ui.panel.classList.contains("of-floating")) return;
		let added = false;
		for (const el of container.querySelectorAll("div")) {
			if (ui.scannedNodes.has(el)) continue;
			ui.scannedNodes.add(el);
			if (ui.panel.contains(el)) continue;
			const id = questIdFromElement(el);
			if (!id || !entries.has(id) || container.querySelector(`[data-of-quest="${id}"]`)) continue;
			el.dataset.ofQuest = id;
			if (getComputedStyle(el).position === "static") el.style.position = "relative";
			el.append(h("button", { type: "button", class: CARD_BTN_CLASS, "data-of-for": id, onClick: onCardButton }));
			added = true;
		}
		if (added) renderCardButtons(getState());
	}

	function onCardButton(event) {
		event.preventDefault();
		event.stopPropagation();
		const id = event.currentTarget.dataset.ofFor;
		const entry = entries.get(id);
		if (!entry) return;
		if (STARTABLE.includes(entry.status)) start(id);
		else if (entry.status === "running" || entry.status === "queued") stop(id);
	}

	function renderCardButtons(state) {
		const byId = new Map(state.map(e => [e.id, e]));
		for (const btn of document.querySelectorAll(`.${CARD_BTN_CLASS}`)) {
			const e = byId.get(btn.dataset.ofFor);
			if (!e) { btn.remove(); continue; }
			const text = {
				available: "⚡ Auto farm",
				idle: "⚡ Auto farm",
				queued: "⏳ Queued · Stop",
				running: `■ ${Math.round(fraction(e) * 100)}% · Stop`,
				done: "✓ Done",
				error: "↻ Retry",
				unsupported: "",
			}[e.status];
			btn.className = `${CARD_BTN_CLASS} of-card-${e.status}`;
			btn.title = e.message || `${APP_NAME}: ${STATUS_LABELS[e.status]}`;
			if (btn.textContent !== text) btn.textContent = text;
		}
	}

	const HIDE_MAX_DEPTH = 8;
	const HIDE_FALLBACK_DEPTH = 3;

	const isProtected = el => el.matches("nav, header, [role='tablist']") || !!el.querySelector(`a[href="${UI_ROUTE}"], [role='tablist'], nav`);
	const isScrollContainer = el => /(auto|scroll)/.test(getComputedStyle(el).overflowY);

	function hideDiscordQuests() {
		if (!(HIDE_DISCORD_QUESTS || HIDE_DISCORD_PROMO) || !ui.panel?.isConnected || ui.panel.classList.contains("of-floating")) return;

		const levels = [];
		let foundScroller = false;
		for (let el = ui.panel; el.parentElement && el.parentElement !== document.body && levels.length < HIDE_MAX_DEPTH; el = el.parentElement) {
			levels.push(el);
			if (isScrollContainer(el.parentElement)) { foundScroller = true; break; }
		}

		const hide = el => { if (!el.hasAttribute("data-of-hidden") && !isProtected(el)) el.setAttribute("data-of-hidden", ""); };
		for (const level of foundScroller ? levels : levels.slice(0, HIDE_FALLBACK_DEPTH)) {
			if (HIDE_DISCORD_QUESTS) for (let el = level.nextElementSibling; el; el = el.nextElementSibling) hide(el);
			if (HIDE_DISCORD_PROMO) for (let el = level.previousElementSibling; el; el = el.previousElementSibling) hide(el);
		}
	}

	function showDiscordQuests() {
		document.querySelectorAll("[data-of-hidden]").forEach(el => el.removeAttribute("data-of-hidden"));
	}

	function maybeScanCards() {
		if (HIDE_DISCORD_QUESTS) return;
		const wait = CARD_SCAN_INTERVAL_MS - (Date.now() - ui.lastCardScan);
		if (wait <= 0) return scanCards();
		if (!ui.cardScanTimer) ui.cardScanTimer = setTimeout(() => { ui.cardScanTimer = null; if (ui.observer) scanCards(); }, wait);
	}

	function findAnchor() {
		const candidates = document.querySelectorAll("h1, h2, h3, h4, [role='heading'], [class*='title'], [class*='heading']");
		for (const el of candidates) {
			if (el.closest(`#${PANEL_ID}`) || !UI_ANCHOR_HEADINGS.includes(el.textContent.trim())) continue;
			let row = el;
			for (let i = 0; i < 4 && row.parentElement; i++) {
				if (row.querySelector("button, [role='button']")) return row;
				row = row.parentElement;
			}
			return el.parentElement ?? el;
		}
		return null;
	}

	function scheduleRender() {
		if (ui.renderQueued) return;
		ui.renderQueued = true;
		setTimeout(() => {
			ui.renderQueued = false;
			renderNav(getState());
			if (ui.panel?.isConnected) renderPanel(ui.panel);
		}, UI_BATCH_MS);
	}

	function mount() {
		if (!document.getElementById(STYLE_ID)) document.head.append(h("style", { id: STYLE_ID }, CSS));
		decorateNav();
		decorateTitle();
		if (!location.pathname.startsWith(UI_ROUTE)) {
			ui.panel?.remove();
			ui.missingSince = 0;
			return;
		}
		ui.panel ??= h("section", { id: PANEL_ID, "aria-label": APP_NAME });
		const panel = ui.panel;
		const floating = panel.classList.contains("of-floating");
		if (panel.isConnected && !floating) {
			hideDiscordQuests();
			return maybeScanCards();
		}
		if (floating && panel.isConnected && Date.now() - ui.lastAnchorTry < 1000) return;
		ui.lastAnchorTry = Date.now();

		const anchor = findAnchor();
		if (anchor) {
			panel.classList.remove("of-floating");
			anchor.parentElement.insertBefore(panel, anchor);
			ui.missingSince = 0;
			renderPanel(panel);
			hideDiscordQuests();
			maybeScanCards();
			return;
		}
		ui.missingSince ||= Date.now();
		const waited = Date.now() - ui.missingSince;
		if (!panel.isConnected && waited >= UI_FALLBACK_DELAY_MS) {
			showDiscordQuests();
			panel.classList.add("of-floating");
			document.body.append(panel);
			renderPanel(panel);
		} else if (!panel.isConnected && !ui.fallbackTimer) {
			ui.fallbackTimer = setTimeout(() => { ui.fallbackTimer = null; scheduleMount(); }, UI_FALLBACK_DELAY_MS - waited + 50);
		}
	}

	function scheduleMount() {
		if (ui.mountQueued || !ui.observer) return;
		ui.mountQueued = true;
		setTimeout(() => {
			ui.mountQueued = false;
			if (ui.observer) mount();
		}, UI_BATCH_MS);
	}

	function startUI() {
		ui.unsubscribe = on(scheduleRender);
		ui.observer = new MutationObserver(scheduleMount);
		ui.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
		mount();
	}

	function destroyUI() {
		ui.observer?.disconnect();
		ui.observer = null;
		clearTimeout(ui.fallbackTimer);
		clearTimeout(ui.cardScanTimer);
		ui.unsubscribe?.();
		ui.panel?.remove();
		document.querySelectorAll(`.${CARD_BTN_CLASS}`).forEach(btn => btn.remove());
		document.querySelectorAll("[data-of-quest]").forEach(el => delete el.dataset.ofQuest);
		restoreNav();
		restoreTitle();
		showDiscordQuests();
		document.getElementById(STYLE_ID)?.remove();
	}

	function destroy() {
		stopAll();
		destroyUI();
		clearTimeout(refreshTimer);
		QuestsStore.removeChangeListener?.(onStoreChange);
		listeners.clear();
		if (window.__orbFarmer === instance) delete window.__orbFarmer;
		log("Destroyed.");
	}

	const instance = { version: VERSION, getState, start, startAll, stop, stopAll, on, destroy };
	window.__orbFarmer = instance;

	refreshQuests();
	startUI();
	const open = getState().filter(e => STARTABLE.includes(e.status));
	console.log(`%c ${APP_NAME} v${VERSION} %c Build by ${AUTHOR} – ${AUTHOR_URL}`, "background: #5865F2; color: #fff; font-weight: bold; border-radius: 4px; padding: 2px 4px", "color: #949ba4");
	log(`${open.length} quest(s) can be farmed. Open the ${APP_NAME} page in the sidebar to see the dashboard, or use window.__orbFarmer.`);
	if (AUTO_START) startAll(open.filter(e => e.status === "idle").map(e => e.id));
})();
