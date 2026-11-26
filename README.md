# Nalla Malayalam — Book Inventory & Sales

A web app for the book business: Book Master, stock, sales across Tele-sales / Online / Onsite, payments and customers, with one login per employee.

Built from *Nalla Malayalam – Book Inventory & Sales Management BA v1.0*. It follows the same stack and conventions as the School Management app (`../../SchoolManagment/nm-school`), and shares its look.

**This is Phase 1 (Core System)** from section 15 of the BA document, plus the small part of Phase 2 that the stock rules cannot work without (order status up to dispatch, and payments against an order). What is and is not built is listed in section 6.

---

## 1. Quick start

Requires Node.js 20 or later.

```bash
npm install
cp .env.example .env          # then set INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD
npm start                     # http://localhost:3000
```

On first start the app creates the first Admin from the two `INITIAL_ADMIN_*` variables. Remove the password from `.env` after that. The Admin then adds everyone else under **Users**.

**Try it with sample data** (fictional customers, kept in a separate local database):

```bash
npm run seed:demo
LOCAL_DB_DIR=data/demo-pg npm start
# admin@ / manager@ / tele@ / online@ / onsite@ / dispatch@ / viewer@demo.local — password: demo-password
```

**Run the tests:** `npm test`

---

## 2. Architecture

| Layer | Choice |
|---|---|
| Server | Node.js + Express 5 |
| Database | PostgreSQL. Supabase in production (`DATABASE_URL`); a built-in local Postgres in `./data/pg` for development, no install needed |
| Hosting | Netlify: static UI from `public/`, the API as one Netlify Function. Migrations run on deploy |
| Auth | bcrypt passwords; a random session token in an httpOnly SameSite cookie, only its hash stored |
| Frontend | Plain ES modules, no build step, self-hosted fonts, strict Content-Security-Policy |

```
server.js               local entry point (loads .env, opens DB, applies migrations, creates first Admin)
netlify/functions/api.js  the same Express app as a Netlify Function
db/migrations/*.sql     numbered schema migrations (never edit an applied one; add a new file)
src/db.js               pg adapter (? and @name placeholders), transactions
src/auth.js             login, sessions, throttling
src/access.js           roles & access: areas, defaults, perm(area) check
src/stock.js            the ONE place stock figures change
src/audit.js            audit trail helper (old/new values, user, time, reason)
src/routes/*.js         users, books, inventory, customers, sales (+ sales-create), dashboard
public/                 the web app (index.html, styles.css, js/core.js, js/app.js, js/pages/*)
scripts/                seed-demo.js, migrate.js, backup.js, bootstrap.js, load-env.js
test/acceptance.test.js API acceptance tests
```

Deployment is the same as the school app: create a Supabase project, set `DATABASE_URL` (Transaction pooler, port 6543) and the `INITIAL_ADMIN_*` variables in Netlify, and deploy. Use a **separate** Supabase project or database from the school app.

**Security:** every API route checks the role on the server; state-changing calls need JSON plus an `X-Requested-With` header (CSRF defence); strict CSP; login throttling; deactivating a user or changing their role ends their sessions; row-level security blocks Supabase's public Data API.

---

## 3. Roles

One role per person: **Admin, Manager, Tele-sales, Online, Onsite, Dispatch, Report Viewer**. The Admin sets what each role can do in **Settings → Roles & access**: for each area, — (hidden), **View** (see, no changes) or **Edit** (see and change). The server checks this on every request (`src/access.js`, `perm(area)`: a GET needs View, anything else Edit); the menu shows only the areas a role can view, a page the role cannot view says "You do not have access", and a view-only page says so and hides its change buttons. The grid is saved in `settings` (key `role_access`) with an optional reason, and each change goes to the audit log. **Reset to defaults** puts back the table below.

Defaults (the access each role had before Roles & access, plus the Report Viewer):

| Area | Admin | Manager | Tele-sales | Online | Onsite | Dispatch | Report Viewer |
|---|---|---|---|---|---|---|---|
| Dashboard | Edit | View | View (own) | View (own) | View (own) | View | View |
| Sales & payments (record, pay, cancel) | Edit | Edit | Edit (own) | Edit (own) | Edit (own) | View (own) | — |
| Dispatch (order status, daily dispatch report) | Edit | Edit | — | — | — | Edit | — |
| Customers | Edit | Edit | Edit | Edit | Edit | — | — |
| Website orders | Edit | Edit | — | Edit | — | — | — |
| Calls (and the tele-sales report) | Edit | Edit | Edit | — | — | — | — |
| Visits | Edit | Edit | — | — | Edit | — | — |
| Book Master | Edit | View | View | View | View | View | — |
| Stock | Edit | View | — | — | — | — | — |
| Costs & profit | Edit | View | — | — | — | — | — |
| Reports (trends, tele-sales and dispatch reports, to read) | Edit | View | — | — | — | — | View |
| Insights | Edit | View | View | — | — | — | View |
| Prices & links (prices on every platform, coupons, links to share) | Edit | View | View | View | View | — | View |
| Corrections (change a saved sale or payment, remove a call or visit, merge customers) | Admin only, fixed | | | | | | |
| Users, roles & Settings | Admin only, fixed | | | | | | |

"Own" is fixed by role, whatever the grid says: Tele-sales, Online and Onsite see their own channel's sales and dashboard figures; Dispatch sees the orders not yet completed. Admin and Report Viewer see every record, like the Manager. A few reads stay open to everyone signed in because every form needs them (the book list, the dropdown lists, your own account). Nobody can change their own role; changing someone's role or making them inactive signs them out at once; there is always at least one active Admin.

Every sale, payment, stock movement and change records the employee who made it.

---

## 4. How the business rules are implemented

| BA rule | Implementation |
|---|---|
| Book selection comes from the Book Master | Sale lines hold a `book_id`; the server rejects unknown or inactive books. |
| Stock is reserved when an order is confirmed | Saving a Tele-sales or Online sale (or an Onsite *order*) adds to `reserved`. Available = in store − reserved. |
| Physical stock is deducted on dispatch | Moving an order to **Dispatched** deducts `on_hand` and uses up the reservation, exactly once even if two people click together. |
| Completed onsite sales deduct stock immediately | Onsite sale with **Books handed over now** ticked is saved as Completed and deducts at once. |
| Cancelled orders release reserved stock | Cancelling (before dispatch, reason required) releases the reservation. |
| Returns update stock after verification | The Admin records **Stock returned**, optionally linked to the order number. |
| Every stock movement has a history | `stock_movements` has one row per change with before/after figures; a test checks stock always equals the sum of its history. |
| No separate stock per school / bookstore | There is one stock pool. Onsite locations are fields on the sale. |
| Multiple books per sale; automatic totals | Line total, total, balance and payment status are calculated in the form and again on the server. |
| Sales linked to customers | With a contact number, the customer is found or created. Numbers match regardless of spaces, `+91` or a leading 0. |
| Multiple payments per order | Each payment is its own record against the order; the amount received is their sum. |
| No duplicate sales | A one-time key stops double clicks saving twice. The same Website/Amazon Order ID cannot be entered twice. |
| Customer figures use actual purchase history | First/last purchase, orders, total and outstanding are calculated from the sales, never stored. Cancelled orders do not count. |
| Audit trail | Books, customers, users and sales keep a change history with old and new values. |

---

## 5. Decisions that need your confirmation

I chose a sensible default for each. All are easy to change.

1. **Overselling is blocked.** An order cannot reserve more copies than are available; the form shows the available number. If you want to take back-orders, this needs a "back-order" state.
2. **Prices are whole rupees.** No paise.
3. **Unit price can be changed on a sale** (for discounts and school rates). It starts at the Book Master price. There is no separate discount field.
4. **Tele-sales needs a contact number and address.** Online needs Platform and Order ID; the contact number is optional. Onsite needs location type and name.
5. **No contact number means no customer record.** The name stays on the sale (typical for Amazon and exhibition walk-ins).
6. **An existing customer keeps their stored name** when a new sale uses the same number with a different name. Empty address/location are filled in.
7. **Sales cannot be edited after saving.** Cancel and re-enter. Payments and status can be updated. Say if you want line editing.
8. **Cancelling does not refund.** Payments on a cancelled order stay on record; refunds are handled outside the app for now.
9. **Dispatched or completed sales cannot be cancelled.** Record returned books under stock movements.
10. **COD** orders start with nothing received and show as COD until a payment is recorded.
11. **Admin manages stock; the Manager only views it**, as in the BA role table.
12. **Sales team members see every sale in their channel**, not only their own; their dashboard shows their own figures.
13. **Payment methods:** UPI, Bank Transfer, COD, Cash, Card, Other.

---

## 6. Scope

**Built (Phase 1):** login and access control · Book Master · inventory with movement history · sales entry for all three channels · customer database with purchase and payment history · payments against orders · order status through to delivery · role-based dashboard · audit trail.

**Not built yet:**

- **Phase 2:** tele-sales call records and follow-ups · onsite visits without a sale · full dispatch module (courier, tracking number, dispatch dashboard) · collection reports · daily team reports
- **Phase 3:** manager dashboard trends and filters · customer purchase analysis ("bought A, not B") · Excel exports and the 17 reports
- **Phase 4:** Google Sheets / Excel / CSV import of historical sales

---

## 7. Real products and the old order sheet

**Sets and combos.** A Book Master entry is either a single book or a set/combo. A set has its own price and a list of the books inside it; it holds no stock itself. Selling a set reserves and deducts each book inside.

**Real product list.** `scripts/catalogue.js` holds the confirmed products (Nalla Malayalam Part 1 and 2, the combo, KVS1/2/3 sets with their story books, KVS Combo, and "Other titles"). Single story-book prices (₹98 / ₹95) and the four KVS3 titles are placeholders: edit them in the Book Master.

**Importing the old Google Sheets orders** (stop the app first when using the built-in local database):

```bash
npm run import:orders -- "/path/to/Nalla Malayalam Orders-2.xlsx" --dry-run   # summary only, saves nothing
npm run import:orders -- "/path/to/Nalla Malayalam Orders-2.xlsx"             # import
```

Each order becomes a Tele-sales sale, Delivered and fully paid, with "Verified By" as the sales person (created as an inactive user). Customers are created by phone number. Rows repeated in the sheet are skipped, and running the import again skips what is already in. **Imported orders never change stock** and cannot be cancelled or moved. The book text as written and any tracking ID are kept in the sale's remarks.

**Tele-sales calls.** Calls page: log a call starting from the contact number (statuses: Answered, Not Answered, Busy, Switched Off, Wrong Number; outcomes: Interested, Not Interested, Follow-up, Sale), a list of follow-ups to make, and each person's call history. A call to a new number creates a **lead**, which becomes a customer on the first purchase. A call with outcome Sale opens the sale form and links the sale to the call. The Tele-sales report (Daily / Weekly / Monthly / Custom, or one row per sales person) is calculated from the call and sale records.

**Onsite visits.** The onsite team records a *visit* (Visits page): books are optional, so a visit with no sale is saved too. Schools and bookstores are saved locations picked from a list (a phone number is not needed); an exhibition is an event, not a customer. A visit with books also creates the sale; a balance needs a due date. "Visits to make" lists next visits that are overdue, due today or upcoming, and visiting the place again completes them.

**Customer filters and Google Contacts.** The Customers page can show repeat customers (2 or more orders) and customers who bought one book or set but not another; buying a combo counts as buying the sets inside it. "Download for Google Contacts" (Admin and Manager) saves the filtered list as a CSV to import at contacts.google.com, under the label *Nalla Malayalam Customers*. Each download is written to the audit trail.

**Old website orders.** `npm run import:website -- "/path/to/old_website_orders.xlsx"` (add `--dry-run` first) reads the WooCommerce order export. Run it *after* the order-sheet import: the team typed most website orders into the Google order sheet as well, so an order whose phone number already has an order from the day before to two weeks after is left out (the summary lists the ones whose amounts differ). The rest are saved as Online / Website sales with the website's order number, real lines and prices, Delivered and paid by card; a delivery charge stays inside the order amount. Stock is never changed, and running it again adds nothing twice.

**Sale form shapes (23 Nov 2026).** Record a sale offers Tele-sales, Online and Exhibition. A tele-sales order takes State (Kerala by default) and District (a list for Kerala, a text box elsewhere), has no due date, and can add a delivery charge and a COD charge by tick box; the amounts are on the Settings page, the COD charge is ticked when the payment method is COD, and both are stored on the sale (`delivery_charge`, `cod_charge`) inside its total. An Exhibition sale needs only the exhibition's name and the books: no address, no next visit date, handed over at once, saved under the Onsite channel with no visit row. Visits to a school or bookstore are recorded from the Visits page only. On Customers, "Bulk order customers" lists anyone with one order of at least the copies or the amount set in Settings (10 copies or ₹3,000 at first), next to the repeat-customers, State and District filters.

**Customer list: two tabs (24 Nov 2026).** Customers shows only complete records. **Update needed** holds the rest, each with its reasons: *Name to check* (a remark or an address instead of a name), *Name in Malayalam*, *PIN missing*, *PIN wrong*, *Address missing*, *No order*. A record leaves the tab as soon as it is fixed; "Name is correct" clears a name flag. The tab also lists **Possible duplicates** (same name and PIN; the Admin merges them, keeping the record with more orders and the other number as a second number) and **Sales with no customer record**. A search looks in both tabs. Every customer carries an **Added from** label (Order sheet, Sales, WhatsApp group, Website, Calls, Visits) with a filter, and the orders filter offers once, twice, 3 or more, and 2 or more. The tele-sales form now has a PIN box. `npm run customers:tidy` (add `--apply` to save) cleans the imported records: WhatsApp notes, labels in names, phone numbers in addresses, district spellings and empty districts from the PIN, State from the PIN, and merges same-name-same-PIN records.

**WhatsApp sales group.** `npm run import:whatsapp -- "/path/to/WhatsApp Chat with ... .txt"` (add `--dry-run` first) reads an exported group chat. A post counts as an order when it has a phone number with a PIN code or an address; call lists and chatter are left out. Each phone number becomes a customer (source "WhatsApp group"); a number already in the app is not changed, except that an empty address, district, State or PIN is filled in. Each order post becomes a Tele-sales sale, Delivered and paid, with the book named in the post ("NML", "Story books", "KVS 1&2", "Part 2" and so on) at the price announced in the group at that date: the two-book pack ₹450 from 21 Mar 2025 and ₹490 from 16 Apr 2025, Part 1 ₹299, Part 2 ₹259, story books (Series 1) ₹320 from 27 Jun 2025 and ₹360 from 16 Nov 2025, Series 2 ₹350, Series 1 + 2 ₹690, pack + story books ₹800, COD ₹30 more (₹25 before July 2025). An amount written in the post is used as it is. A post with no book named counts as the two-book pack before 27 Jun 2025 and makes no sale after it. A post whose phone number already has an order in the app within ten days either side is taken to be that order. The same order posted again within three days is counted once. Stock is never touched, and running it again adds nothing twice. Run it after the order-sheet import.

**Website orders every month.** The **Website orders** page (Admin, Manager, Online team) takes the order file downloaded from the website, as CSV or Excel. "Check file" shows what would happen and saves nothing; "Add the orders" saves. Duplicates are ignored: an order number uploaded before or already entered by hand, and an order whose phone number already has an order from the day before to two weeks after. Orders that are not Processing or Completed on the website are left out. The new website's file (columns Order, Customer, Email, Amount, Payment, Status, Date) is understood as well: an order counts when its payment is CAPTURED and it is not cancelled, failed or refunded. That file has no phone number, address or items, so its orders get no customer record (name and email are kept on the sale), and the book is taken from the amount when exactly one book or set has that website price; otherwise the order sits under "Other titles". Until someone uploads in the current month, the dashboard shows a reminder to these roles from the 1st; an upload with nothing new still marks the month as done. Uploaded orders are saved as Online / Website, paid by card and Delivered, and never change stock. `npm run import:website` runs the same import from the command line.

**Old daily dispatch form.** `npm run import:dispatch -- "/path/to/Daily Dispatch - Report Responses.xlsx"` (add `--dry-run` first) fills the **Dispatch report** page with the form's history: one figure per day and product, with the single books typed in the form's "Other" box recognised by name. A mistyped date is replaced by the day the form was filled in, two entries for one day are added together, and a test entry is left out. It replaces the imported history each time, so a newer export can be imported over the old one; a day typed in the app is left as typed.

**Daily dispatch report in the app.** On the Dispatch report page, **Add daily report** (Admin, Manager, Dispatch) opens the same form as the old Google Form: a date, a count for each set and book, and up to a few other items by name. Saving replaces that day's report, clearing every count removes it, and each change is kept in the history. The **Edit** button on a day opens it again. Stock is not changed by these reports. Orders moved to Dispatched in the app are counted by themselves, so use one way for a day, not both.

**Product list from the website.** `scripts/catalogue.js` follows nallamalayalam.in/books (story-book names and prices, Series 3 titles, the 12-book bundle). On a database that already has the products, run `npm run catalogue:update` to apply it.

**Prices and discounts (24 Nov 2026).** Everything sells at its MRP except the sets in a discount group, which sell at the MRP less a percentage for the channel. The groups and the starting rates (Settings → Discounts, Admin): Nalla Malayalam Part 1 + 2 — Website 18%, WhatsApp/tele-sales 15%, Amazon and Flipkart 10%; Kuttivayana two series (1+2, 2+3 or 1+3) — 15% / 10% / 10%; Kuttivayana all three series — 20% / 15% / 10%. Onsite and exhibition sales are at MRP. Which set is in which group is chosen in the Book Master (`books.discount_group`); prices are worked out when needed (`src/prices.js`) and rounded to whole rupees. A price typed on the sale always wins. Online orders can be Website, Amazon or Flipkart (Flipkart uses the Amazon rate). Migration 0014 sets every selling price to its MRP, drops the old per-book Website/Amazon prices, and puts the existing sets in their groups; `scripts/catalogue.js` adds the Kuttivayana 2 + 3 and 1 + 3 sets.

**Delivery and COD.** A tele-sales order adds a ₹40 delivery charge when the books come to ₹492 or less (free above that) and a ₹10 COD charge when the payment method is COD. All three amounts are in Settings; the delivery tick box can still be changed by hand on the sale.

**Theme.** The Admin picks the colours of the whole app in Settings → Theme (green, blue, teal, maroon, purple, orange, charcoal). The choice applies to everyone, the sign-in page included (read without signing in from `/api/theme`), and the logo takes the theme colour (the green logo PNG is used as a CSS mask). Each theme keeps text contrast at 4.5:1 or better.

**Customers: sort and "not bought since" (27 Nov 2026).** The customer list can be sorted (last purchase newest or oldest first, most orders, most spent, name, newest customers) and filtered to customers who have ordered before but not in the last 3, 6 or 12 months.

**Follow-up lists.** With the filters set, **Save as a follow-up list** keeps the customers shown under a name, with a note for the team (`follow_up_lists`, `follow_up_members`). The members stay fixed. Each has a status: Not contacted yet, Contacted, No answer, Feedback requested, Feedback received, Review requested, Review posted, Ordered again, Not interested. The team sets it by hand; the app also moves people forward, never back: opening a WhatsApp message (feedback → Feedback requested, review → Review requested, any other → Contacted), logging a call (answered → Contacted, otherwise No answer), a feedback answer (Feedback received), and an order entered after the list was made (Ordered again, with the order). A closed list can be read but not changed until it is reopened. Lists use the Customers area of Roles & access.

**WhatsApp messages and feedback.** The WhatsApp button (a customer, the customers shown, a follow-up list) offers: Feedback request, Website review request, Coupon (after a review), New product, Language Academy, Share with friends, Own message. The wording, the website and review addresses, the coupon and the Academy text are set in Settings → General → Customer messages; `{name}`, `{link}`, `{review_link}`, `{website}`, `{coupon}`, `{product}`, `{price}`, `{academy_text}`, `{academy_link}` are filled in for each customer. WhatsApp opens with the text typed in and the person presses Send; each opened message is noted on the customer (`customer_messages`). A feedback request carries the customer's own link, `/f/<token>` (24 random characters; an unanswered link is reused for 30 days). That public page needs no sign-in, shows only the first name, and asks for stars, what they like most, why they bought and a comment; an answer can be changed for 7 days. A 5-star answer is asked for a website review and told to send a screenshot for a coupon (the coupon itself is sent by the team with the Coupon message). Answers are on Customers → Feedback and on the customer's page.

**Labels, bills and order messages (27 Nov 2026).** Any sale has **Print bill** (an A4 bill with the books, charges, paid and balance, and the UPI ID while money is due). Orders that go by post have **Print label**, and Sales has **Print labels** for the orders shown: two labels per A4 page in the website's layout (to address, PIN and phone; PREPAID or "COD · collect ₹…"; courier and tracking number as a Code 128 barcode, or a blank box when there is none yet; logo; India Post booking office, biller name, SPCOD biller ID and contract ID; order number with its barcode; books; gift pack; return address). The page is `/print.html` (`public/js/print.js`, `barcode.js`, `print.css`) and uses the signed-in session. Dispatch types or scans the courier and tracking number on the sale before printing, or when marking it Dispatched (`sales.courier`, `sales.tracking_no`); the sale form has a **Gift pack** tick box (`sales.gift_pack`). After a tele-sales or online sale is saved, the sale offers **Send order confirmation** on WhatsApp (books, charges, total, and how to pay: UPI ID, cash on delivery, or paid in full); marking Dispatched can open WhatsApp with the **Dispatched** message (courier, tracking number, tracking page). The label details, couriers (name | tracking page) and the wording of both messages are in Settings → General.

**Next book.** Customers → Next book counts, for each step in Settings (first book → next book; by default NM Part 1 → Part 2, NM set → Kuttivayana Series 1, KVS 1 → 2, KVS 2 → 3, KVS Bundle 1 → Series 3), the customers who own the first but not the next and have bought nothing for the waiting time (1 month by default). "See them" opens Customers with that filter (`ready_for`); "Make a follow-up list" saves them as a list. Customers already in an open list made for the same step are left out.

**Insights (Tele-sales → Insights).** One page on where customers are, when they buy and answer the phone, and how they buy, for the tele-sales team (`/api/insights`, `public/js/pages/insights.js`). Four advice cards (best time to call, when to call back, busy season, where to call first); a Kerala district map (tiles, coloured by customers, orders, sales, repeat rate or customers with nothing in 6 months) with a table per district (customers, orders, repeat rate, average order, top book, COD share, nothing in 6 months, and **Make a list**, which saves those quiet customers as a follow-up list); calls answered by day and time (shown once 200 calls are logged in the period, as call times are the only times of day the app has); orders by month and weekday; time from first to second order; and buying patterns (first book, what the second order holds, payment methods, multi-copy orders, calls that end in a sale). Filters: period, channel, book. Access: the Insights area of Roles & access (Admin, Manager, Tele-sales and Report Viewer by default).

**Book Master from the website (27 Nov 2026).** Book Master shows two lists, **Books** and **Bundles**; each entry carries its Malayalam title, author (where the website gives one), website page and an Amazon link field. SKUs are the website's (`NMP1OCT2026`, `KVS1BUNDLEOCT2026`, `KVS123BUNDLENOV2026` …), so the website order import matches them directly. Migration 0018 renames the old SKUs, fills in the Malayalam titles, authors and website links, updates the next-book suggestions and saved follow-up lists to the new SKUs, and adds the Kuttivayana Series 2 & 3 (`KVS23BUNDLENOV2026`) and Series 1 & 3 (`KVS-13`, not on the website) bundles if the database does not have them. "Pinne njaanengane poo tharendoo" is not in the app. Search in Book Master also matches Malayalam titles and authors.

**Prices & links (Sales → Prices & links).** One page for the tele team (`/api/pricelist`, `public/js/pages/pricelist.js`): links to share (website, books page, Amazon, YouTube, Instagram, Facebook — each with Copy and WhatsApp), offers and coupons with what they give, who they are for, where they work and until when (Running / Upcoming; the Admin also sees Ended and Stopped), and every book and bundle with its MRP and price on the website, WhatsApp/phone, Amazon/Flipkart and onsite, with a link to its website page. The Admin adds and edits coupons (`coupons` table; codes are upper case, unique) and the links (Settings key `links`). Empty links are hidden. The coupon itself still has to be set up on the website: this page only tells the team about it.

**Costs & profit.** Hidden from the menu for now (24 Nov 2026); the page still opens at `#/profit`. Admin and Manager have a Costs & profit page. Each book or set has its costs per copy (printing, packing, postal, misc, ad cost, Amazon fee, royalty %, commission %); the page shows profit and margin per copy for tele-sales, Website, Amazon and onsite, the break-even price, and an estimate of profit on what was sold in a period. "Try a price" in the cost form shows what a school or bookstall rate leaves. The starting figures come from the costing sheet (`scripts/catalogue.js`, `COSTS`) and are only filled in where a product has none.

**Admin corrections and settings.** The Admin can: change a saved sale (details and books; stock and totals are corrected with it), change or remove a payment, change or remove a call or a visit, edit the dropdown lists (Settings: payment methods, call statuses and outcomes, onsite location types, customer types) and choose which costs count for each channel (Costs & profit). Every correction asks for a reason and is kept in the history. A few list choices the app's rules depend on (COD, Answered, Follow-up, Sale, School, Bookstore, Exhibition, the four base customer types) cannot be removed.

**Dashboard charts.** Admin and Manager see sales charts under the dashboard figures: sales by day, week or month, and by product, sales person, district, channel and payment. Filters: period, channel, sales person, book. Each bar opens the orders behind it. The charts are plain SVG drawn by `public/js/charts.js`; the data comes from `GET /api/dashboard/trends`.

**WhatsApp, one at a time.** The Customers page and each customer profile have a WhatsApp button. It opens WhatsApp with a message typed in (optionally about a chosen book); the person presses Send. The app itself sends nothing.

## 8. Tests

`npm test` runs 45 API acceptance tests covering: rejected unauthenticated/cross-site requests · user management per role · Book Master and its audit trail · manual stock movements and the no-negative-stock rule · tele-sales, online and onsite sales · customer matching by contact number · per-role visibility · multiple payments · dispatch deducting once under simultaneous clicks · cancellation releasing stock · returns · stock equal to its movement history · no overselling under simultaneous orders · dashboard figures matching the records.

Note on the local database: the built-in development Postgres is a single shared session, so the app gives it one connection and requests take turns. Supabase uses a normal connection pool; stock changes are single guarded statements backed by database CHECK constraints, so they are safe there too.
