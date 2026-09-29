// /privacy — the privacy policy. eBay requires a live https privacy-policy URL
// on the RuName (it is linked from the "Grant application access" screen a
// seller sees when connecting their eBay account), and it has to describe
// what this app really keeps. Keep it in step with the schema: accounts,
// sessions, activity_log, inventory + photos, ebay_connections, sold_sales.

type Page = { html: string; title: string; description: string };

export const PRIVACY_CONTACT = "thegivingbulbasaur@gmail.com";
const UPDATED = "September 28, 2026";

export function renderPrivacy(): Page {
  const mail = `<a href="mailto:${PRIVACY_CONTACT}">${PRIVACY_CONTACT}</a>`;
  const html = `<div class="wrap prose" style="max-width:760px;padding:32px 16px 56px">
    <h1>Privacy policy</h1>
    <p class="hint">Last updated ${UPDATED} · applies to tradingcardloader.com</p>

    <p>This page explains what information Trading Card Loader (the “site”) collects, why, who it is shared with, and how to have it removed. Questions go to ${mail}.</p>

    <h2>What we collect</h2>
    <h3>If you just browse</h3>
    <ul>
      <li>No account and no tracking profile. We don’t use advertising or analytics cookies.</li>
      <li>Your theme choice (light or dark) is kept in your own browser’s storage, not on our servers.</li>
      <li>Our host keeps standard server logs (such as IP address, time and page requested) for security and troubleshooting.</li>
    </ul>
    <h3>If you create a seller account</h3>
    <ul>
      <li><b>Account details:</b> your email address, shop name, and your password stored only as a one-way hash. We never see or store your password in plain text.</li>
      <li><b>Sign-in cookie:</b> a session cookie that keeps you signed in. It is required for the workspace to work.</li>
      <li><b>Your workspace:</b> card photos you upload, your inventory, prices, listing drafts, orders you record, and your settings.</li>
      <li><b>Activity log:</b> sign-ins and actions inside your workspace (what was done and when), used for support, security and account management.</li>
      <li><b>Photo matching:</b> photos are used to identify your cards for you. They are used to improve identification <i>only</i> if you turn on that option in Settings, and it is off by default.</li>
    </ul>
    <h3>If you connect your eBay account</h3>
    <p>Connecting is optional. You sign in on eBay’s own page, and we never receive your eBay password. With your permission, eBay gives us:</p>
    <ul>
      <li>your eBay username and user ID;</li>
      <li>access tokens that let the site list, revise and end listings, read your business policies, read your orders and mark them shipped, on your behalf;</li>
      <li>the business policies and ship-from location you choose.</li>
    </ul>
    <p>From your <b>paid eBay orders</b> we keep only the card title, sale price, sale date, listing number and your SKU. These become sold-price comparisons that other visitors can see. We do <b>not</b> store buyer names, usernames, addresses or contact details.</p>

    <h2>How we use it</h2>
    <ul>
      <li>To run the service: identify and price cards, manage inventory, and publish and sync your eBay listings and orders.</li>
      <li>To show public price data: live eBay listings and an archive of sold prices with no personal details.</li>
      <li>To keep the site secure, fix problems, and answer support requests.</li>
      <li>To send account emails, such as password resets.</li>
    </ul>
    <p>We don’t sell your personal information, and we don’t use it for advertising.</p>

    <h2>Who we share it with</h2>
    <ul>
      <li><b>eBay:</b> only when you connect your account, and only to do what you ask (publish listings, sync orders and so on). eBay’s own privacy notice covers what happens there.</li>
      <li><b>Service providers:</b> our hosting, database and file-storage providers, and an email provider for account emails. They process data only to run the site.</li>
      <li><b>Affiliate links:</b> some links to eBay and TCGplayer carry an affiliate tag. If you click one, that marketplace may record the click under its own privacy policy. We don’t pass them your personal information.</li>
      <li><b>When required by law</b>, or to protect the site and its users.</li>
    </ul>

    <h2>How long we keep it</h2>
    <ul>
      <li>Account and workspace data: while your account is open.</li>
      <li>eBay connection: until you click <b>Disconnect</b> in Settings → eBay, or until eBay tells us you closed your eBay account. Either one deletes your stored eBay username, user ID, tokens and settings straight away.</li>
      <li>Sold-price records contain no personal details and may be kept as market history.</li>
    </ul>

    <h2>eBay account deletion</h2>
    <p>We subscribe to eBay’s Marketplace Account Deletion notifications. When eBay tells us a member has closed or deleted their account, we delete all eBay data we hold for that member.</p>

    <h2>Your choices and rights</h2>
    <ul>
      <li>Disconnect eBay at any time from Settings → eBay.</li>
      <li>Turn photo matching for identification improvements on or off in Settings.</li>
      <li>Email ${mail} to ask for a copy of your data, a correction, or deletion of your account and its data. We’ll respond within 30 days.</li>
    </ul>
    <p>Depending on where you live (for example California, the EU or the UK), you may have additional rights under local law. Contact us to use them.</p>

    <h2>Security</h2>
    <p>Traffic to the site is encrypted (HTTPS), passwords are hashed, and access to the back office is restricted. No system is perfectly secure. If we learn of a breach affecting your data, we’ll tell you.</p>

    <h2>Children</h2>
    <p>The site is not directed at children under 13, and we don’t knowingly collect their information.</p>

    <h2>Changes</h2>
    <p>If this policy changes, we’ll update the date at the top. Significant changes will be announced on the site or by email.</p>

    <h2>Contact</h2>
    <p>${mail}</p>
  </div>`;
  return { html, title: "Privacy policy | Trading Card Loader", description: "What Trading Card Loader collects, how it is used and shared, and how to have it removed." };
}
