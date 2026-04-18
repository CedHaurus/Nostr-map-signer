const ext = typeof browser !== "undefined" && browser.runtime ? browser : chrome;

const params = new URLSearchParams(window.location.search);
const requestId = params.get("requestId");

function api(message) {
  return ext.runtime.sendMessage(message).then((response) => {
    if (!response.ok) throw new Error(response.error || "Erreur.");
    return response.result;
  });
}

async function loadZap() {
  const request = await api({ action: "getZapRequest", requestId });
  document.getElementById("recipient").textContent = request.recipient;
  document.getElementById("amount").textContent = request.amountSats
    ? `${request.amountSats.toLocaleString("fr-FR")} sats`
    : "Montant non précisé";
  document.getElementById("balance").textContent = request.balanceLabel
    ? `${request.balanceLabel} sats`
    : "Solde indisponible";

  if (request.insufficientBalance) {
    document.getElementById("insufficient-balance-warning").classList.remove("hidden");
    document.getElementById("approve-zap").disabled = true;
    document.getElementById("approve-zap").style.opacity = "0.5";
    document.getElementById("approve-zap").title = "Solde insuffisant";
  }
}

document.getElementById("approve-zap").addEventListener("click", async () => {
  await api({ action: "approveZap", requestId });
  window.close();
});

document.getElementById("reject-zap").addEventListener("click", async () => {
  try {
    await api({ action: "rejectZap", requestId });
  } finally {
    window.close();
  }
});

loadZap().catch(() => window.close());
