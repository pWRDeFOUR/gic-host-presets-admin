(function () {
    const FIREBASE_CONFIG = window.GIC_FIREBASE_CONFIG || null;
    const SETTINGS = window.GIC_ADMIN_SETTINGS || {};
    const ROOT_PATH = safeTrim(SETTINGS.rootPath || "hostPresets/v1");

    const state = {
        user: null,
        acl: null,
        providers: {},
        selectedProviderId: "",
        editingHostId: ""
    };

    const els = {
        configAlert: byId("configAlert"),
        authPanel: byId("authPanel"),
        appPanel: byId("appPanel"),
        aclPanel: byId("aclPanel"),
        mainPanel: byId("mainPanel"),
        authStatus: byId("authStatus"),
        appStatus: byId("appStatus"),
        userLabel: byId("userLabel"),
        uidLabel: byId("uidLabel"),
        providerList: byId("providerList"),
        hostsBody: byId("hostsBody"),
        aclPath: byId("aclPath"),
        aclSample: byId("aclSample")
    };

    if (!isConfigValid(FIREBASE_CONFIG)) {
        els.configAlert.classList.remove("hidden");
        setStatus(els.authStatus, "Firebase config missing in firebase-config.js", "err");
        disableAllButtons();
        return;
    }

    firebase.initializeApp(FIREBASE_CONFIG);
    const auth = firebase.auth();
    const db = firebase.database();

    wireEvents();
    auth.onAuthStateChanged(onAuthStateChanged);

    function wireEvents() {
        byId("signInBtn").onclick = signIn;
        byId("createUserBtn").onclick = createUser;
        byId("resetPasswordBtn").onclick = resetPassword;
        byId("signOutBtn").onclick = signOut;

        byId("refreshBtn").onclick = loadAclAndProviders;
        byId("addProviderBtn").onclick = addProvider;
        byId("deleteProviderBtn").onclick = deleteProvider;
        byId("saveProviderBtn").onclick = saveProvider;
        byId("saveHostBtn").onclick = saveHost;
        byId("cancelHostEditBtn").onclick = resetHostForm;
    }

    function disableAllButtons() {
        document.querySelectorAll("button").forEach(function (button) {
            button.disabled = true;
        });
    }

    function isConfigValid(config) {
        return !!(config
            && safeTrim(config.apiKey)
            && safeTrim(config.authDomain)
            && safeTrim(config.databaseURL)
            && safeTrim(config.projectId));
    }

    function byId(id) {
        return document.getElementById(id);
    }

    function safeTrim(value) {
        return value == null ? "" : String(value).trim();
    }

    function nowMs() {
        return Date.now();
    }

    function setStatus(target, text, kind) {
        target.className = "status";
        if (kind) {
            target.classList.add(kind);
        }
        target.textContent = text || "";
    }

    function escapeHtml(value) {
        return safeTrim(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function makePath() {
        const parts = [ROOT_PATH];
        for (let i = 0; i < arguments.length; i++) {
            parts.push(arguments[i]);
        }
        return parts
            .map(function (part) { return safeTrim(part).replace(/^\/+|\/+$/g, ""); })
            .filter(Boolean)
            .join("/");
    }

    function normalizeSlug(raw) {
        const value = safeTrim(raw).toLowerCase();
        if (!/^[a-z0-9_-]+$/.test(value)) {
            return "";
        }
        return value;
    }

    function parsePositiveInt(raw) {
        const value = parseInt(String(raw || "").trim(), 10);
        return Number.isFinite(value) && value > 0 ? value : 0;
    }

    function normalizeBaseUrl(raw) {
        let value = safeTrim(raw);
        if (!value) {
            return "";
        }
        if (!/^https?:\/\//i.test(value)) {
            value = "http://" + value;
        }
        try {
            const parsed = new URL(value);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
                return "";
            }
            const portPart = parsed.port ? ":" + parsed.port : "";
            return parsed.protocol + "//" + parsed.hostname + portPart;
        } catch (e) {
            return "";
        }
    }

    function autoGenerateHostId(provider) {
        const usedIds = provider && provider.hosts ? Object.keys(provider.hosts) : [];
        let maxId = 0;
        usedIds.forEach(function (id) {
            const numeric = parsePositiveInt(id);
            if (numeric > maxId) {
                maxId = numeric;
            }
        });
        return String(maxId + 1);
    }

    function buildReindexedHostsMap(provider) {
        const source = provider && provider.hosts ? provider.hosts : {};
        const entries = Object.keys(source).map(function (hostId) {
            const host = source[hostId] || {};
            const numericId = parsePositiveInt(hostId);
            const orderRaw = parseInt(host.order, 10);
            return {
                oldHostId: hostId,
                numericId: numericId > 0 ? numericId : Number.MAX_SAFE_INTEGER,
                order: Number.isFinite(orderRaw) ? orderRaw : Number.MAX_SAFE_INTEGER,
                host: host
            };
        }).sort(function (a, b) {
            if (a.numericId !== b.numericId) {
                return a.numericId - b.numericId;
            }
            if (a.order !== b.order) {
                return a.order - b.order;
            }
            return a.oldHostId.localeCompare(b.oldHostId);
        });

        const output = {};
        for (let i = 0; i < entries.length; i++) {
            const id = String(i + 1);
            const src = entries[i].host || {};
            output[id] = {
                baseUrl: src.baseUrl || "",
                enabled: src.enabled !== false,
                order: i + 1,
                updatedAtMs: src.updatedAtMs || nowMs(),
                updatedByUid: src.updatedByUid || (state.user ? state.user.uid : "")
            };
        }
        return output;
    }

    async function signIn() {
        const email = safeTrim(byId("emailInput").value);
        const password = byId("passwordInput").value || "";
        if (!email || !password) {
            setStatus(els.authStatus, "Enter email and password.", "err");
            return;
        }
        setStatus(els.authStatus, "Signing in...");
        try {
            await auth.signInWithEmailAndPassword(email, password);
            setStatus(els.authStatus, "Signed in.", "ok");
        } catch (e) {
            setStatus(els.authStatus, e.message || "Sign in failed.", "err");
        }
    }

    async function createUser() {
        const email = safeTrim(byId("emailInput").value);
        const password = byId("passwordInput").value || "";
        if (!email || !password || password.length < 6) {
            setStatus(els.authStatus, "Provide email and password (min 6 chars).", "err");
            return;
        }
        setStatus(els.authStatus, "Creating user...");
        try {
            await auth.createUserWithEmailAndPassword(email, password);
            setStatus(els.authStatus, "User created and signed in. Add ACL before use.", "warn");
        } catch (e) {
            setStatus(els.authStatus, e.message || "Create user failed.", "err");
        }
    }

    async function resetPassword() {
        const email = safeTrim(byId("emailInput").value);
        if (!email) {
            setStatus(els.authStatus, "Enter email first.", "err");
            return;
        }
        setStatus(els.authStatus, "Sending reset email...");
        try {
            await auth.sendPasswordResetEmail(email);
            setStatus(els.authStatus, "Password reset email sent.", "ok");
        } catch (e) {
            setStatus(els.authStatus, e.message || "Reset password failed.", "err");
        }
    }

    async function signOut() {
        await auth.signOut();
    }

    function isSuperAdmin() {
        return !!(state.acl && state.acl.superAdmin === true);
    }

    function allowedProviderIds() {
        if (!state.acl) {
            return [];
        }
        if (isSuperAdmin()) {
            return Object.keys(state.providers || {});
        }
        const providers = state.acl.providers || {};
        return Object.keys(providers).filter(function (providerId) {
            return providers[providerId] === true;
        });
    }

    function canEditProvider(providerId) {
        if (!state.user || !providerId) {
            return false;
        }
        if (isSuperAdmin()) {
            return true;
        }
        return !!(state.acl && state.acl.providers && state.acl.providers[providerId] === true);
    }

    async function onAuthStateChanged(user) {
        state.user = user || null;
        state.acl = null;
        state.providers = {};
        state.selectedProviderId = "";

        if (!user) {
            els.authPanel.classList.remove("hidden");
            els.appPanel.classList.add("hidden");
            els.aclPanel.classList.add("hidden");
            els.mainPanel.classList.add("hidden");
            els.userLabel.textContent = "";
            els.uidLabel.textContent = "";
            els.providerList.innerHTML = "";
            els.hostsBody.innerHTML = "";
            setStatus(els.appStatus, "");
            return;
        }

        els.authPanel.classList.add("hidden");
        els.appPanel.classList.remove("hidden");
        els.userLabel.textContent = "Signed in as " + safeTrim(user.email);
        els.uidLabel.textContent = "uid: " + safeTrim(user.uid);
        setStatus(els.appStatus, "Loading ACL and providers...");

        try {
            await loadAclAndProviders();
        } catch (e) {
            setStatus(els.appStatus, e.message || "Failed to load ACL/providers.", "err");
        }
    }

    async function loadAclAndProviders() {
        if (!state.user) {
            return;
        }

        const uid = safeTrim(state.user.uid);
        const aclSnapshot = await db.ref(makePath("adminAcl", uid)).once("value");
        state.acl = aclSnapshot.val();

        if (!state.acl) {
            renderAclHelp();
            els.mainPanel.classList.add("hidden");
            setStatus(els.appStatus, "Signed in but ACL is missing for this user.", "warn");
            return;
        }

        els.aclPanel.classList.add("hidden");

        const providersSnapshot = await db.ref(makePath("providers")).once("value");
        state.providers = providersSnapshot.val() || {};

        const allowedIds = allowedProviderIds();
        if (!allowedIds.length) {
            state.selectedProviderId = "";
        } else if (allowedIds.indexOf(state.selectedProviderId) < 0) {
            state.selectedProviderId = allowedIds[0];
        }

        els.mainPanel.classList.remove("hidden");
        renderProviders();
        renderSelectedProvider();
        setStatus(els.appStatus, "Providers loaded.", "ok");
    }

    function renderAclHelp() {
        if (!state.user) {
            return;
        }
        els.aclPanel.classList.remove("hidden");
        els.aclPath.textContent = makePath("adminAcl", state.user.uid);
        const sample = {
            email: safeTrim(state.user.email),
            superAdmin: false,
            providers: {
                tiger_iptv: true
            },
            updatedAtMs: nowMs()
        };
        els.aclSample.textContent = JSON.stringify(sample, null, 2);
    }

    function renderProviders() {
        const ids = allowedProviderIds().sort(function (a, b) {
            return a.localeCompare(b);
        });
        els.providerList.innerHTML = "";

        if (!ids.length) {
            els.providerList.innerHTML = "<div class=\"tiny\">No providers assigned.</div>";
            return;
        }

        ids.forEach(function (providerId) {
            const provider = state.providers[providerId] || {};
            const displayName = safeTrim(provider.displayName) || providerId;
            const enabled = provider.enabled !== false;

            const item = document.createElement("div");
            item.className = "provider-item" + (providerId === state.selectedProviderId ? " active" : "");
            item.innerHTML = "<div><strong>" + escapeHtml(displayName) + "</strong></div>"
                + "<div class=\"meta\">" + escapeHtml(providerId) + " | enabled: " + enabled + "</div>";
            item.onclick = function () {
                state.selectedProviderId = providerId;
                renderProviders();
                renderSelectedProvider();
            };
            els.providerList.appendChild(item);
        });
    }

    function readProviderHostEntries(provider) {
        if (!provider || !provider.hosts) {
            return [];
        }

        return Object.keys(provider.hosts)
            .map(function (hostId) {
                const host = provider.hosts[hostId] || {};
                const orderRaw = parseInt(host.order, 10);
                return {
                    hostId: hostId,
                    baseUrl: normalizeBaseUrl(host.baseUrl || ""),
                    order: Number.isFinite(orderRaw) ? orderRaw : parsePositiveInt(hostId),
                    enabled: host.enabled !== false,
                    updatedAtMs: Number(host.updatedAtMs || 0)
                };
            })
            .filter(function (entry) {
                return !!entry.baseUrl;
            })
            .sort(function (left, right) {
                const leftId = parsePositiveInt(left.hostId);
                const rightId = parsePositiveInt(right.hostId);
                if (leftId > 0 && rightId > 0 && leftId !== rightId) {
                    return leftId - rightId;
                }
                return left.hostId.localeCompare(right.hostId);
            });
    }

    function renderSelectedProvider() {
        const providerId = state.selectedProviderId;
        const provider = providerId ? (state.providers[providerId] || {}) : null;
        const editable = providerId && canEditProvider(providerId);

        byId("providerIdInput").value = providerId || "";
        byId("providerNameInput").value = provider ? (safeTrim(provider.displayName) || providerId) : "";
        byId("providerEnabledInput").checked = provider ? provider.enabled !== false : true;

        byId("saveProviderBtn").disabled = !editable;
        byId("deleteProviderBtn").disabled = !editable;
        byId("saveHostBtn").disabled = !editable;

        els.hostsBody.innerHTML = "";
        if (!provider) {
            resetHostForm();
            return;
        }

        readProviderHostEntries(provider).forEach(function (host) {
            const row = document.createElement("tr");
            row.innerHTML = "<td>" + escapeHtml(host.hostId) + "</td>"
                + "<td>" + escapeHtml(host.baseUrl) + "</td>"
                + "<td>" + host.enabled + "</td>"
                + "<td>"
                + "<button data-host-id=\"" + escapeHtml(host.hostId) + "\" data-action=\"edit\">Edit</button> "
                + "<button class=\"danger\" data-host-id=\"" + escapeHtml(host.hostId) + "\" data-action=\"delete\">Delete</button>"
                + "</td>";
            const buttons = row.querySelectorAll("button");
            buttons.forEach(function (button) {
                const action = button.getAttribute("data-action");
                button.onclick = function () {
                    if (action === "edit") {
                        startEditHost(host.hostId);
                        return;
                    }
                    deleteHost(host.hostId);
                };
                button.disabled = !editable;
            });
            els.hostsBody.appendChild(row);
        });

        resetHostForm();
    }

    function startEditHost(hostId) {
        const providerId = state.selectedProviderId;
        const provider = providerId ? (state.providers[providerId] || {}) : null;
        const host = provider && provider.hosts ? (provider.hosts[hostId] || null) : null;
        if (!provider || !host) {
            setStatus(els.appStatus, "Host not found for editing.", "err");
            return;
        }
        state.editingHostId = hostId;
        byId("hostIdInput").value = hostId;
        byId("hostUrlInput").value = safeTrim(host.baseUrl);
        byId("hostEnabledInput").checked = host.enabled !== false;
        byId("saveHostBtn").textContent = "Update Host";
        byId("cancelHostEditBtn").classList.remove("hidden");
    }

    function resetHostForm() {
        const providerId = state.selectedProviderId;
        const provider = providerId ? (state.providers[providerId] || {}) : null;
        state.editingHostId = "";
        byId("hostIdInput").value = provider ? autoGenerateHostId(provider) : "";
        byId("hostUrlInput").value = "";
        byId("hostEnabledInput").checked = true;
        byId("saveHostBtn").textContent = "Save Host";
        byId("cancelHostEditBtn").classList.add("hidden");
    }

    async function addProvider() {
        if (!state.user) {
            return;
        }

        const raw = window.prompt("Provider ID (slug, e.g. tiger_iptv)");
        const providerId = normalizeSlug(raw);
        if (!providerId) {
            setStatus(els.appStatus, "Invalid provider ID.", "err");
            return;
        }

        if (!isSuperAdmin() && !canEditProvider(providerId)) {
            setStatus(els.appStatus, "Provider not assigned in ACL.", "err");
            return;
        }

        await db.ref(makePath("providers", providerId)).update({
            providerId: providerId,
            displayName: providerId,
            enabled: true,
            updatedAtMs: nowMs(),
            updatedByUid: state.user.uid
        });

        state.selectedProviderId = providerId;
        await loadAclAndProviders();
        setStatus(els.appStatus, "Provider " + providerId + " created.", "ok");
    }

    async function saveProvider() {
        const providerId = normalizeSlug(byId("providerIdInput").value);
        if (!providerId) {
            setStatus(els.appStatus, "Select a provider first.", "err");
            return;
        }
        if (!canEditProvider(providerId)) {
            setStatus(els.appStatus, "No permission for this provider.", "err");
            return;
        }

        const displayName = safeTrim(byId("providerNameInput").value) || providerId;
        const enabled = byId("providerEnabledInput").checked;

        await db.ref(makePath("providers", providerId)).update({
            providerId: providerId,
            displayName: displayName,
            enabled: enabled,
            updatedAtMs: nowMs(),
            updatedByUid: state.user.uid
        });

        await loadAclAndProviders();
        setStatus(els.appStatus, "Provider " + providerId + " saved.", "ok");
    }

    async function deleteProvider() {
        const providerId = state.selectedProviderId;
        if (!providerId) {
            return;
        }
        if (!canEditProvider(providerId)) {
            setStatus(els.appStatus, "No permission for this provider.", "err");
            return;
        }

        if (!window.confirm("Delete provider \"" + providerId + "\" and all its hosts?")) {
            return;
        }

        await db.ref(makePath("providers", providerId)).remove();
        state.selectedProviderId = "";
        await loadAclAndProviders();
        setStatus(els.appStatus, "Provider " + providerId + " deleted.", "ok");
    }

    async function saveHost() {
        const providerId = state.selectedProviderId;
        if (!providerId || !canEditProvider(providerId)) {
            setStatus(els.appStatus, "Select an editable provider first.", "err");
            return;
        }

        const baseUrl = normalizeBaseUrl(byId("hostUrlInput").value);
        const provider = state.providers[providerId] || {};
        const hostId = safeTrim(state.editingHostId) || autoGenerateHostId(provider);
        byId("hostIdInput").value = hostId;
        const enabled = byId("hostEnabledInput").checked;

        if (!hostId) {
            setStatus(els.appStatus, "Invalid host ID. Use letters/numbers/_/- or leave empty for auto.", "err");
            return;
        }
        if (!baseUrl) {
            setStatus(els.appStatus, "Invalid host URL. Use http://domain:port", "err");
            return;
        }

        await db.ref(makePath("providers", providerId, "hosts", hostId)).set({
            baseUrl: baseUrl,
            order: parsePositiveInt(hostId),
            enabled: enabled,
            updatedAtMs: nowMs(),
            updatedByUid: state.user.uid
        });

        await db.ref(makePath("providers", providerId)).update({
            updatedAtMs: nowMs(),
            updatedByUid: state.user.uid
        });

        await loadAclAndProviders();
        setStatus(els.appStatus, "Host " + hostId + " saved.", "ok");
    }

    async function deleteHost(hostId) {
        const providerId = state.selectedProviderId;
        if (!providerId || !hostId || !canEditProvider(providerId)) {
            setStatus(els.appStatus, "No permission.", "err");
            return;
        }

        if (!window.confirm("Delete host \"" + hostId + "\"?")) {
            return;
        }

        await db.ref(makePath("providers", providerId, "hosts", hostId)).remove();

        const refreshedProviderSnapshot = await db.ref(makePath("providers", providerId)).once("value");
        const refreshedProvider = refreshedProviderSnapshot.val() || {};
        const reindexedHosts = buildReindexedHostsMap(refreshedProvider);
        await db.ref(makePath("providers", providerId, "hosts")).set(reindexedHosts);

        await db.ref(makePath("providers", providerId)).update({
            updatedAtMs: nowMs(),
            updatedByUid: state.user.uid
        });

        await loadAclAndProviders();
        setStatus(els.appStatus, "Host " + hostId + " deleted.", "ok");
    }
})();
