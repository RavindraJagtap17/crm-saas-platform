const jwt = require("jsonwebtoken");
const metaIntegrationModel = require("../models/metaIntegrationModel");
const graphClient = require("../integrations/meta/graphClient");
const { encrypt, decrypt } = require("../utils/encryption");
const httpError = require("../utils/httpError");
const config = require("../config");

const OAUTH_SCOPES = ["pages_show_list", "leads_retrieval", "pages_manage_metadata", "pages_read_engagement"].join(",");
const STATE_EXPIRY = "10m";

// The OAuth "state" param carries the client/admin through Meta's
// redirect without needing server-side session storage — signed with the
// same JWT secret already used for access tokens (reuse, not new
// crypto), and short-lived so a captured URL can't be replayed later.
function issueState(clientId, adminUserId) {
  return jwt.sign({ clientId, adminUserId, purpose: "meta_oauth" }, config.jwt.accessSecret, { expiresIn: STATE_EXPIRY });
}

function verifyState(state) {
  try {
    const payload = jwt.verify(state, config.jwt.accessSecret);
    if (payload.purpose !== "meta_oauth") throw new Error("wrong purpose");
    return payload;
  } catch {
    throw httpError("This connection link has expired or is invalid. Please start over from the CRM.", 400, "META_STATE_INVALID");
  }
}

function isTokenExpired(settings) {
  if (!settings?.token_expires_at) return false; // Meta indicated no expiry
  return new Date(settings.token_expires_at).getTime() < Date.now();
}

// Never includes access_token_encrypted or anything derived from it.
function serializeConnection(settings) {
  if (!settings) return { connected: false };
  return {
    connected: true,
    pageId: settings.page_id,
    pageName: settings.page_name,
    adAccountId: settings.ad_account_id,
    pixelId: settings.pixel_id,
    tokenExpiresAt: settings.token_expires_at,
    isExpired: isTokenExpired(settings),
    connectedAt: settings.created_at,
  };
}

async function getConnection(clientId) {
  const settings = await metaIntegrationModel.findByClient(clientId);
  return serializeConnection(settings);
}

async function beginConnect(clientId, adminUserId) {
  const state = issueState(clientId, adminUserId);
  const url = new URL("https://www.facebook.com/v19.0/dialog/oauth");
  url.searchParams.set("client_id", config.meta.appId);
  url.searchParams.set("redirect_uri", config.meta.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", OAUTH_SCOPES);
  url.searchParams.set("response_type", "code");
  return { authorizationUrl: url.toString() };
}

/**
 * §B: the callback Meta redirects the browser back to. Verifies state,
 * exchanges the code, upgrades to a long-lived token, fetches the user's
 * pages, and connects the first one — "only what is necessary for lead
 * ingestion" (§I), not a full page/ad-account picker UI. Documented as a
 * Phase 1 simplification in the Step 7 report.
 */
async function completeConnect(code, state) {
  const { clientId } = verifyState(state);

  const shortLived = await graphClient.exchangeCodeForToken(code);
  const longLived = await graphClient.exchangeForLongLivedToken(shortLived.access_token);

  const pagesResponse = await graphClient.getPages(longLived.access_token);
  const pages = pagesResponse.data || [];
  if (pages.length === 0) {
    throw httpError("No Meta Pages were found for this account. Connect an account that manages at least one Page.", 400, "META_NO_PAGES");
  }
  const page = pages[0];

  let adAccountId = null;
  try {
    const adAccountsResponse = await graphClient.getAdAccounts(longLived.access_token);
    adAccountId = adAccountsResponse.data?.[0]?.id || null;
  } catch {
    // Ad account access is optional for lead ingestion itself (leads come
    // via the Page) — a failure here shouldn't block the connection.
  }

  // Meta's long-lived user token is what pages_show_list-derived page
  // tokens are ultimately backed by; expires_in of 0/absent means "no
  // fixed expiry" per Meta's documented behavior for this token type.
  const tokenExpiresAt = longLived.expires_in ? new Date(Date.now() + longLived.expires_in * 1000) : null;

  try {
    const settings = await metaIntegrationModel.upsert(clientId, {
      adAccountId,
      pageId: page.id,
      pageName: page.name,
      accessTokenEncrypted: encrypt(page.access_token),
      tokenExpiresAt,
    });
    return serializeConnection(settings);
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      throw httpError("This Meta Page is already connected to another client's account.", 409, "META_PAGE_ALREADY_CONNECTED");
    }
    throw err;
  }
}

async function disconnect(clientId) {
  const removed = await metaIntegrationModel.remove(clientId);
  if (!removed) throw httpError("No Meta connection to remove.", 404);
}

// Step 8 (§C/§D of the CAPI spec): the client's Meta Pixel/Dataset ID —
// where a conversion event actually gets sent. Entered manually by the
// Client Admin on the same connection page; see migration 016's comment
// for why this can't be reliably auto-discovered via OAuth.
async function setPixelId(clientId, pixelId) {
  const trimmed = typeof pixelId === "string" ? pixelId.trim() : "";
  if (!trimmed) throw httpError("pixelId is required.", 400);
  if (trimmed.length > 64) throw httpError("pixelId is too long.", 400);
  const settings = await metaIntegrationModel.setPixelId(clientId, trimmed);
  if (!settings) throw httpError("Connect a Meta account before setting a Pixel ID.", 400, "META_NOT_CONNECTED");
  return serializeConnection(settings);
}

// Used only by metaLeadService (ingestion) and the "list forms" admin
// endpoint — never returns the decrypted token to any HTTP response.
async function getDecryptedAccessToken(clientId) {
  const settings = await metaIntegrationModel.findByClient(clientId);
  if (!settings) return null;
  return { settings, accessToken: decrypt(settings.access_token_encrypted) };
}

module.exports = {
  getConnection,
  beginConnect,
  completeConnect,
  disconnect,
  setPixelId,
  getDecryptedAccessToken,
  isTokenExpired,
  serializeConnection,
};
