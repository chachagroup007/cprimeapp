(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
  const form = $("#deal-form"), notice = $("#notice"), formStatus = $("#form-status");
  const productSearch = $("#product-search"), productResults = $("#product-results"), selectedProductId = $("#selected-product-id"), selectedProduct = $("#selected-product");
  let productSearchTimer = null, productRequest = 0;
  const bodies = [$("#deals-body"), $("#deals-body-alt")].filter(Boolean);
  let allDeals = [], shop = "";

  function setNotice(message, kind = "") {
    notice.textContent = message;
    notice.className = "notice" + (kind ? " notice--" + kind : "");
    const label = $("#connection-label"), connection = $(".connection");
    if (label && connection) {
      label.textContent = kind === "success" ? "Connected" : kind === "error" ? "Needs attention" : "Checking connection";
      connection.classList.toggle("is-connected", kind === "success");
    }
  }
  function money(amount, currency) {
    const value = Number(amount);
    if (!Number.isFinite(value)) return "—";
    try { return new Intl.NumberFormat(undefined, {style:"currency",currency:currency || "USD"}).format(value); }
    catch { return value.toFixed(2) + " " + (currency || "USD"); }
  }
  function dateLabel(value) {
    if (!value) return "No end date";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric"});
  }
  async function getToken() {
    if (!window.shopify || typeof window.shopify.idToken !== "function") {
      throw new Error("Shopify App Bridge is not ready. Open this app from Shopify Admin → Apps, not in a standalone browser tab.");
    }
    return window.shopify.idToken();
  }
  async function api(path, options = {}) {
    const token = await getToken();
    const response = await fetch(path,{...options,headers:{Accept:"application/json","Content-Type":"application/json",Authorization:"Bearer "+token,...(options.headers || {})}});
    const data = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(data.error || "Request failed ("+response.status+")");
    return data;
  }
  function statusPill(status) {
    const s = String(status || "draft").toLowerCase();
    const valid = ["active","draft","scheduled","successful","failed","cancelled"].includes(s) ? s : "draft";
    const el = document.createElement("span"); el.className = "status-pill status-"+valid; el.textContent = valid; return el;
  }
  function cell(row, cls = "") { const el = document.createElement("td"); if (cls) el.className = cls; row.appendChild(el); return el; }
  function renderDeals() {
    const query = ($("#deal-search")?.value || $("#deal-search-alt")?.value || "").trim().toLowerCase();
    const filter = $("#status-filter")?.value || $("#status-filter-alt")?.value || "all";
    const deals = allDeals.filter(d => {
      const title = String(d.title || d.shopify_product_id || "").toLowerCase();
      return (!query || title.includes(query) || String(d.shopify_product_id || "").includes(query)) &&
        (filter === "all" || String(d.status).toLowerCase() === filter);
    });
    bodies.forEach(body => {
      body.replaceChildren();
      if (!deals.length) {
        const tr = document.createElement("tr"), td = cell(tr,"empty"); td.colSpan = 6;
        td.textContent = allDeals.length ? "No deals match these filters." : "No group deals yet. Create your first offer to get started.";
        body.appendChild(tr); return;
      }
      deals.forEach(deal => {
        const tr = document.createElement("tr"), title = cell(tr,"deal-title");
        const name = document.createElement("div"); name.textContent = deal.title || ("Product #"+(deal.shopify_product_id || "—")); title.appendChild(name);
        const id = document.createElement("small"); id.textContent = "Product ID: "+(deal.shopify_product_id || "—"); title.appendChild(id);
        cell(tr).appendChild(statusPill(deal.status));
        const progress = cell(tr,"progress-cell"), current = Math.max(0,Number(deal.current_quantity || 0)), target = Math.max(0,Number(deal.target_quantity || 0)), pct = target ? Math.min(100,Math.round(current/target*100)) : 0;
        const copy = document.createElement("div"); copy.className = "progress-copy";
        const count = document.createElement("span"); count.textContent = current+" / "+target;
        const percentage = document.createElement("strong"); percentage.textContent = pct+"%"; copy.append(count,percentage);
        const track = document.createElement("div"); track.className = "progress-track";
        const fill = document.createElement("div"); fill.className = "progress-fill"; fill.style.width = pct+"%"; track.appendChild(fill); progress.append(copy,track);
        cell(tr,"price-cell").textContent = money(deal.group_price,deal.currency);
        cell(tr).textContent = dateLabel(deal.ends_at);
        const actions = cell(tr), button = document.createElement("button"); button.type = "button"; button.className = "table-action";
        const future = deal.starts_at && new Date(deal.starts_at).getTime() > Date.now();
        const scheduleDraft = deal.status === "draft" && future;
        button.textContent = scheduleDraft ? "Schedule" : deal.status === "draft" ? "Activate" : deal.status === "scheduled" ? "Cancel schedule" : deal.status === "active" ? "Cancel" : "Details";
        const next = ["active","scheduled"].includes(deal.status) ? "cancelled" : scheduleDraft ? "scheduled" : "active";
        button.disabled = !["draft","scheduled","active"].includes(deal.status);
        button.addEventListener("click",async()=>{
          button.disabled = true;
          try { await api("/api/admin/deals/"+encodeURIComponent(deal.id)+"/status",{method:"PATCH",body:JSON.stringify({status:next})}); await loadDeals(); }
          catch(e){setNotice(e.message,"error");button.disabled=false;}
        });
        actions.appendChild(button); body.appendChild(tr);
      });
    });
    $("#table-count").textContent = "Showing "+deals.length+" of "+allDeals.length+" deals";
    $("#nav-deal-count").textContent = String(allDeals.length);
  }
  async function loadDeals() {
    const data = await api("/api/admin/deals");
    allDeals = Array.isArray(data.deals) ? data.deals : [];
    $("#stat-total").textContent = String(allDeals.length);
    $("#stat-active").textContent = String(allDeals.filter(d=>d.status==="active").length);
    $("#stat-units").textContent = String(allDeals.reduce((sum,d)=>sum+Number(d.current_quantity || 0),0));
    $("#stat-scheduled").textContent = String(allDeals.filter(d=>d.status==="scheduled").length);
    $("#stat-successful").textContent = String(allDeals.filter(d=>d.status==="successful").length);
    renderDeals(); setNotice("Connected. Your group-deal data is up to date.","success");
    if ($("#settings-connection")) { $("#settings-connection").textContent="Connected"; $("#settings-connection").className="setting-state"; }
  }
  function showView(view) {
    const current = ["dashboard","deals","create","settings"].includes(view) ? view : "dashboard";
    $$(".view").forEach(v=>v.classList.toggle("is-visible",v.id==="view-"+current));
    $$(".nav-item").forEach(n=>n.classList.toggle("is-active",n.dataset.view===current));
    $("#breadcrumb-current").textContent = ({dashboard:"Overview",deals:"Group deals",create:"Create a deal",settings:"Store & setup"})[current];
    if (history.replaceState) history.replaceState(null,"",location.pathname+location.search+"#"+current);
  }
  $$("[data-view]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));
  $$("[data-go]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.go)));
  $$(".search-box input").forEach(input=>input.addEventListener("input",e=>{$$(".search-box input").forEach(other=>{if(other!==e.target)other.value=e.target.value;});renderDeals();}));
  $$(".filter-wrap select").forEach(select=>select.addEventListener("change",e=>{$$(".filter-wrap select").forEach(other=>{if(other!==e.target)other.value=e.target.value;});renderDeals();}));

  function clearProductSelection() {
    selectedProductId.value = "";
    selectedProduct.hidden = true;
    selectedProduct.replaceChildren();
  }
  function renderProductResults(products) {
    productResults.replaceChildren();
    if (!products.length) {
      const empty = document.createElement("div"); empty.className = "product-result-empty";
      empty.textContent = "No matching active products found."; productResults.appendChild(empty);
    } else products.forEach(product => {
      const option = document.createElement("button"); option.type = "button"; option.className = "product-option"; option.setAttribute("role","option");
      if (product.image) { const img = document.createElement("img"); img.src = product.image; img.alt = ""; img.loading = "lazy"; option.appendChild(img); }
      const info = document.createElement("span"); info.className = "product-option-info";
      const title = document.createElement("strong"); title.textContent = product.title;
      const meta = document.createElement("small"); meta.textContent = "Product #" + product.id + " · " + money(product.price,product.currency);
      info.append(title,meta); option.appendChild(info);
      option.addEventListener("click",() => {
        selectedProductId.value = product.id; productSearch.value = product.title; productResults.replaceChildren(); productResults.classList.remove("is-open");
        selectedProduct.replaceChildren();
        if (product.image) { const img = document.createElement("img"); img.src = product.image; img.alt = ""; selectedProduct.appendChild(img); }
        const copy = document.createElement("span"); copy.className = "selected-product-copy";
        const name = document.createElement("strong"); name.textContent = product.title;
        const detail = document.createElement("small"); detail.textContent = "Retail price " + money(product.price,product.currency) + " · Currency " + product.currency;
        copy.append(name,detail); selectedProduct.appendChild(copy);
        const currency = form.elements.currency;
        if ([...currency.options].some(o=>o.value===product.currency)) currency.value = product.currency;
        selectedProduct.hidden = false;
      });
      productResults.appendChild(option);
    });
    productResults.classList.add("is-open");
  }
  productSearch.addEventListener("input", () => {
    clearProductSelection();
    const query = productSearch.value.trim();
    clearTimeout(productSearchTimer); productResults.replaceChildren();
    if (query.length < 2) { productResults.classList.remove("is-open"); return; }
    const request = ++productRequest;
    productSearchTimer = setTimeout(async () => {
      try {
        const data = await api("/api/admin/products?q=" + encodeURIComponent(query));
        if (request === productRequest) renderProductResults(Array.isArray(data.products) ? data.products : []);
      } catch (e) {
        if (request === productRequest) { const err = document.createElement("div"); err.className = "product-result-empty"; err.textContent = e.message; productResults.replaceChildren(err); productResults.classList.add("is-open"); }
      }
    }, 280);
  });
  document.addEventListener("click", event => {
    if (!event.target.closest("#product-results") && event.target !== productSearch) productResults.classList.remove("is-open");
  });

  form.addEventListener("submit",async event=>{
    event.preventDefault(); const values = new FormData(form), end = values.get("ends_at"), start = values.get("starts_at");
    const payload = {shopify_product_id:String(values.get("shopify_product_id")||"").trim(),title:String(values.get("title")||"").trim(),group_price:Number(values.get("group_price")),target_quantity:Number(values.get("target_quantity")),currency:values.get("currency"),pricing_mode:values.get("pricing_mode"),ends_at:end?new Date(end).toISOString():"",starts_at:start?new Date(start).toISOString():null};
    const submit = form.querySelector('button[type="submit"]'); submit.disabled=true; formStatus.textContent="Creating draft…";
    try { await api("/api/admin/deals",{method:"POST",body:JSON.stringify(payload)}); form.reset(); selectedProductId.value=""; selectedProduct.hidden=true; selectedProduct.replaceChildren(); formStatus.textContent="Draft created successfully."; await loadDeals(); showView("deals"); }
    catch(e){formStatus.textContent=e.message;setNotice(e.message,"error");}
    finally{submit.disabled=false;}
  });

  $("#export-deals").addEventListener("click", () => {
    const columns = ["title","shopify_product_id","status","current_quantity","target_quantity","group_price","currency","starts_at","ends_at","created_at"];
    const escapeCsv = value => '"' + String(value == null ? "" : value).replace(/"/g,'""') + '"';
    const rows = [columns, ...allDeals.map(deal => columns.map(key => deal[key] ?? ""))];
    const csv = "\\uFEFF" + rows.map(row => row.map(escapeCsv).join(",")).join("\\r\\n");
    const url = URL.createObjectURL(new Blob([csv], {type:"text/csv;charset=utf-8;"}));
    const link = document.createElement("a"); link.href = url; link.download = "chachaprime-group-deals.csv";
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  });

  $("#refresh").addEventListener("click",()=>loadDeals().catch(e=>setNotice(e.message,"error")));
  const params = new URLSearchParams(location.search); shop = params.get("shop") || "";
  if ($("#settings-store")) $("#settings-store").textContent = shop || "No store domain detected";
  const hash = location.hash.slice(1); if(hash) showView(hash);
  window.addEventListener("hashchange", () => showView(location.hash.slice(1) || "dashboard"));
  window.addEventListener("hashchange", () => showView(location.hash.slice(1) || "dashboard"));
  if (!shop.endsWith(".myshopify.com")) {
    setNotice("Open this app from Shopify Admin → Apps using the installed store. Direct browser access cannot create an embedded session.","error");
    if ($("#settings-connection")) { $("#settings-connection").textContent="Not connected"; $("#settings-connection").className="setting-state neutral"; }
    return;
  }
  loadDeals().catch(e=>{setNotice(e.message,"error");if($("#settings-connection")){$("#settings-connection").textContent="Needs attention";$("#settings-connection").className="setting-state neutral";}});
})();