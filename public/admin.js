(() => {
  const $ = (selector) => document.querySelector(selector);
  const form = $("#deal-form");
  const body = $("#deals-body");
  const notice = $("#notice");
  const formStatus = $("#form-status");
  let sessionToken = "";
  let shop = "";

  function setNotice(message, kind = "") {
    notice.textContent = message;
    notice.className = "notice" + (kind ? " notice--" + kind : "");
  }

  function money(amount, currency) {
    const value = Number(amount);
    if (!Number.isFinite(value)) return "—";
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(value); }
    catch { return value.toFixed(2) + " " + (currency || "USD"); }
  }

  function dateLabel(value) {
    if (!value) return "No start date";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
  }

  async function getToken() {
    if (!window.shopify || typeof window.shopify.idToken !== "function") {
      throw new Error("Shopify App Bridge is not ready. Open this page from Shopify Admin.");
    }
    return window.shopify.idToken();
  }

  async function api(path, options = {}) {
    sessionToken = await getToken();
    const response = await fetch(path, {
      ...options,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: "Bearer " + sessionToken,
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed (" + response.status + ")");
    return data;
  }

  function addCell(row, text) {
    const cell = document.createElement("td");
    cell.textContent = text;
    row.appendChild(cell);
    return cell;
  }

  function renderDeals(deals) {
    body.replaceChildren();
    if (!deals.length) {
      const row = document.createElement("tr");
      const cell = addCell(row, "No group deals yet. Create your first draft above.");
      cell.colSpan = 6;
      cell.className = "empty";
      body.appendChild(row);
      return;
    }

    for (const deal of deals) {
      const row = document.createElement("tr");
      const titleCell = addCell(row, deal.title || "Untitled deal");
      titleCell.className = "deal-title";
      addCell(row, deal.status);
      const progress = Number(deal.current_quantity || 0) + " / " + Number(deal.target_quantity || 0);
      addCell(row, progress);
      addCell(row, money(deal.group_price, deal.currency));
      addCell(row, dateLabel(deal.ends_at));

      const actionCell = document.createElement("td");
      const action = document.createElement("button");
      action.type = "button";
      action.className = "button button-small";
      const futureStart = deal.starts_at && new Date(deal.starts_at).getTime() > Date.now();
      const scheduleDraft = deal.status === "draft" && futureStart;
      action.textContent = scheduleDraft ? "Schedule" :
        deal.status === "draft" ? "Activate" :
        deal.status === "scheduled" ? "Cancel schedule" :
        deal.status === "active" ? "Cancel" : "—";
      const nextStatus = ["active", "scheduled"].includes(deal.status) ? "cancelled" : scheduleDraft ? "scheduled" : "active";
      action.disabled = !["draft", "scheduled", "active"].includes(deal.status);
      action.addEventListener("click", async () => {
        action.disabled = true;
        try {
          await api("/api/admin/deals/" + encodeURIComponent(deal.id) + "/status", {
            method: "PATCH", body: JSON.stringify({ status: nextStatus }),
          });
          await loadDeals();
        } catch (error) {
          setNotice(error.message, "error");
          action.disabled = false;
        }
      });
      actionCell.appendChild(action);
      row.appendChild(actionCell);
      body.appendChild(row);
    }
  }

  async function loadDeals() {
    const data = await api("/api/admin/deals");
    const deals = Array.isArray(data.deals) ? data.deals : [];
    $("#stat-total").textContent = String(deals.length);
    $("#stat-active").textContent = String(deals.filter((deal) => deal.status === "active").length);
    $("#stat-units").textContent = String(deals.reduce((sum, deal) => sum + Number(deal.current_quantity || 0), 0));
    renderDeals(deals);
    setNotice("Connected. Deal data is up to date.", "success");
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = new FormData(form);
    const endValue = values.get("ends_at");
    const startValue = values.get("starts_at");
    const payload = {
      shopify_product_id: String(values.get("shopify_product_id") || "").trim(),
      group_price: Number(values.get("group_price")),
      target_quantity: Number(values.get("target_quantity")),
      currency: values.get("currency"),
      pricing_mode: values.get("pricing_mode"),
      ends_at: endValue ? new Date(endValue).toISOString() : "",
      starts_at: startValue ? new Date(startValue).toISOString() : null,
    };
    formStatus.textContent = "Creating draft…";
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await api("/api/admin/deals", { method: "POST", body: JSON.stringify(payload) });
      form.reset();
      formStatus.textContent = "Draft created.";
      await loadDeals();
    } catch (error) {
      formStatus.textContent = error.message;
      setNotice(error.message, "error");
    } finally {
      submit.disabled = false;
    }
  });

  $("#refresh").addEventListener("click", () => loadDeals().catch((error) => setNotice(error.message, "error")));

  const params = new URLSearchParams(window.location.search);
  shop = params.get("shop") || "";
  $("#store-label").textContent = shop || "Shopify store";
  if (!shop.endsWith(".myshopify.com")) {
    setNotice("Open this app from Shopify Admin using a valid store domain.", "error");
    return;
  }
  loadDeals().catch((error) => setNotice(error.message, "error"));
})();
