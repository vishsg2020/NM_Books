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
# admin@ / manager@ / tele@ / online@ / onsite@ / dispatch@demo.local — password: demo-password
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
src/auth.js             login, sessions, roles, throttling
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

| Area | Admin | Manager | Tele-sales | Online | Onsite | Dispatch |
|---|---|---|---|---|---|---|
| Users | Manage | — | — | — | — | — |
| Book Master | Add / edit | View | View | View | View | View |
| Stock movements | Record + view | View | — | — | — | — |
| Record a sale | Any channel | Any channel | Tele-sales | Online | Onsite | — |
| See sales | All | All | Tele-sales | Online | Onsite | Orders to ship |
| Record a payment | Yes | Yes | Own channel | Own channel | Own channel | — |
| Packing / dispatch status | Yes | Yes | — | — | — | Yes |
| Cancel an order | Yes | Yes | Own channel | Own channel | Own channel | — |
| Customers | View / edit | View / edit | View / edit | View / edit | View / edit | — |
| Dashboard | Business | Business | Own figures | Own figures | Own figures | Dispatch queue |

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

**Website orders every month.** The **Website orders** page (Admin, Manager, Online team) takes the order file downloaded from the website, as CSV or Excel. "Check file" shows what would happen and saves nothing; "Add the orders" saves. Duplicates are ignored: an order number uploaded before or already entered by hand, and an order whose phone number already has an order from the day before to two weeks after. Orders that are not Processing or Completed on the website are left out. The new website's file (columns Order, Customer, Email, Amount, Payment, Status, Date) is understood as well: an order counts when its payment is CAPTURED and it is not cancelled, failed or refunded. That file has no phone number, address or items, so its orders get no customer record (name and email are kept on the sale), and the book is taken from the amount when exactly one book or set has that website price; otherwise the order sits under "Other titles". Until someone uploads in the current month, the dashboard shows a reminder to these roles from the 1st; an upload with nothing new still marks the month as done. Uploaded orders are saved as Online / Website, paid by card and Delivered, and never change stock. `npm run import:website` runs the same import from the command line.

**Old daily dispatch form.** `npm run import:dispatch -- "/path/to/Daily Dispatch - Report Responses.xlsx"` (add `--dry-run` first) fills the **Dispatch report** page with the form's history: one figure per day and product, with the single books typed in the form's "Other" box recognised by name. A mistyped date is replaced by the day the form was filled in, two entries for one day are added together, and a test entry is left out. It replaces the imported history each time, so a newer export can be imported over the old one; a day typed in the app is left as typed.

**Daily dispatch report in the app.** On the Dispatch report page, **Add daily report** (Admin, Manager, Dispatch) opens the same form as the old Google Form: a date, a count for each set and book, and up to a few other items by name. Saving replaces that day's report, clearing every count removes it, and each change is kept in the history. The **Edit** button on a day opens it again. Stock is not changed by these reports. Orders moved to Dispatched in the app are counted by themselves, so use one way for a day, not both.

**Product list from the website.** `scripts/catalogue.js` follows nallamalayalam.in/books (story-book names and prices, Series 3 titles, the 12-book bundle). On a database that already has the products, run `npm run catalogue:update` to apply it.

**Price by channel.** A book or set can have a Website price and an Amazon price besides its selling price (Book Master → Edit). An Online sale picks the price for its platform automatically; tele-sales and onsite use the selling price. A price typed on the sale always wins. Prices are whole rupees, so the website's ₹654.50 for Bundle 1 is held as ₹655.

**Costs & profit.** Admin and Manager have a Costs & profit page. Each book or set has its costs per copy (printing, packing, postal, misc, ad cost, Amazon fee, royalty %, commission %); the page shows profit and margin per copy for tele-sales, Website, Amazon and onsite, the break-even price, and an estimate of profit on what was sold in a period. "Try a price" in the cost form shows what a school or bookstall rate leaves. The starting figures come from the costing sheet (`scripts/catalogue.js`, `COSTS`) and are only filled in where a product has none.

**Admin corrections and settings.** The Admin can: change a saved sale (details and books; stock and totals are corrected with it), change or remove a payment, change or remove a call or a visit, edit the dropdown lists (Settings: payment methods, call statuses and outcomes, onsite location types, customer types) and choose which costs count for each channel (Costs & profit). Every correction asks for a reason and is kept in the history. A few list choices the app's rules depend on (COD, Answered, Follow-up, Sale, School, Bookstore, Exhibition, the four base customer types) cannot be removed.

**Dashboard charts.** Admin and Manager see sales charts under the dashboard figures: sales by day, week or month, and by product, sales person, district, channel and payment. Filters: period, channel, sales person, book. Each bar opens the orders behind it. The charts are plain SVG drawn by `public/js/charts.js`; the data comes from `GET /api/dashboard/trends`.

**WhatsApp, one at a time.** The Customers page and each customer profile have a WhatsApp button. It opens WhatsApp with a message typed in (optionally about a chosen book); the person presses Send. The app itself sends nothing.

## 8. Tests

`npm test` runs 29 API acceptance tests covering: rejected unauthenticated/cross-site requests · user management per role · Book Master and its audit trail · manual stock movements and the no-negative-stock rule · tele-sales, online and onsite sales · customer matching by contact number · per-role visibility · multiple payments · dispatch deducting once under simultaneous clicks · cancellation releasing stock · returns · stock equal to its movement history · no overselling under simultaneous orders · dashboard figures matching the records.

Note on the local database: the built-in development Postgres is a single shared session, so the app gives it one connection and requests take turns. Supabase uses a normal connection pool; stock changes are single guarded statements backed by database CHECK constraints, so they are safe there too.
