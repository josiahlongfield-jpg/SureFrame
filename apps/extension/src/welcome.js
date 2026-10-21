// Asks for the camera once, for the extension itself. After that the bubble can show it on any web page.
const allow = document.getElementById("allow");
const status = document.getElementById("status");
const preview = document.getElementById("preview");

function done() {
  allow.hidden = true;
  status.className = "status";
  status.textContent = "All set. Your camera bubble will appear when you record your screen with SureFrame.";
}

async function ask() {
  allow.disabled = true;
  status.textContent = "";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    preview.srcObject = stream;
    preview.hidden = false;
    done();
    // A moment to see yourself, then the camera is let go.
    setTimeout(() => {
      stream.getTracks().forEach((t) => t.stop());
      preview.hidden = true;
    }, 4000);
  } catch (err) {
    allow.disabled = false;
    status.className = "status bad";
    status.textContent =
      err?.name === "NotAllowedError"
        ? "The camera was blocked. Click the camera icon in the address bar, choose Allow, then try again."
        : "No camera was found, or another app is using it. Check it's plugged in, then try again.";
  }
}

allow.addEventListener("click", ask);
// Already allowed (opened again later): say so.
navigator.permissions
  ?.query({ name: "camera" })
  .then((p) => p.state === "granted" && done())
  .catch(() => {});
