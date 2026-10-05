(function () {
  "use strict";
  const form = document.getElementById("application-form");
  if (!form) return;
  const helpers = window.VoidRecruitment;
  const steps = [...form.querySelectorAll("[data-form-step]")];
  const stepButtons = [...document.querySelectorAll("[data-step-jump]")];
  const key = "void-recruitment-draft-v1";
  let currentStep = 1,
    maxVisited = 1,
    submitting = false,
    dirty = false,
    previewFinished = false;
  let reviewStep = 1;
  const totalSteps = 5;
  const stepFor = (n) => form.querySelector('[data-form-step="' + n + '"]');
  const storage = {
    read() {
      try {
        return JSON.parse(sessionStorage.getItem(key));
      } catch {
        return null;
      }
    },
    write(data) {
      try {
        sessionStorage.setItem(key, JSON.stringify(data));
        return true;
      } catch {
        return false;
      }
    },
    clear() {
      try {
        sessionStorage.removeItem(key);
      } catch {}
    },
  };
  function selectedRoles() {
    return [...form.querySelectorAll('input[name="roles"]:checked')].map(
      (f) => f.value,
    );
  }
  function saveDraft(previewComplete = previewFinished) {
    previewFinished = previewComplete;
    const values = {};
    for (const field of form.querySelectorAll(
      "input[name], textarea[name], select[name]",
    )) {
      if (field.type === "checkbox" || field.type === "radio") {
        if (!values[field.name]) values[field.name] = [];
        if (field.checked) values[field.name].push(field.value);
      } else values[field.name] = field.value;
    }
    const saved = storage.write({
      version: 1,
      values,
      step: currentStep,
      maxVisited,
      updatedAt: new Date().toISOString(),
      previewComplete,
    });
    document.querySelector("[data-draft-state]").textContent = saved
      ? "Draft saved in this tab. Nothing sent."
      : "Answers kept on this page. Keep it open.";
    return saved;
  }
  function clearErrors() {
    for (const f of form.querySelectorAll("[aria-invalid]")) {
      f.removeAttribute("aria-invalid");
      const ids = (f.getAttribute("aria-describedby") || "")
        .split(" ")
        .filter((id) => !id.startsWith("validation-"));
      if (ids.length) f.setAttribute("aria-describedby", ids.join(" "));
      else f.removeAttribute("aria-describedby");
    }
    for (const n of form.querySelectorAll(".has-error"))
      n.classList.remove("has-error");
    for (const n of form.querySelectorAll(".field-error")) n.remove();
    const summary = document.getElementById("error-summary");
    summary.hidden = true;
    summary.querySelector("ul").replaceChildren();
  }
  function fieldLabel(field) {
    return (
      field.dataset.errorLabel ||
      (
        form.querySelector('label[for="' + CSS.escape(field.id) + '"]')
          ?.textContent || field.name
      )
        .replace(/\*/g, "")
        .replace(/Optional/g, "")
        .trim()
    );
  }
  function errorsFor(n) {
    const errors = [];
    const step = stepFor(n);
    for (const field of step.querySelectorAll("input,textarea,select")) {
      const role = field.closest("[data-role-section]");
      if (
        field.disabled ||
        (role && !selectedRoles().includes(role.dataset.roleSection))
      )
        continue;
      if (field.type === "checkbox" || field.type === "radio") continue;
      const val = field.value.trim();
      if ((field.required || field.hasAttribute("data-role-required")) && !val)
        errors.push({
          field,
          message: "Enter " + fieldLabel(field).toLowerCase() + ".",
        });
      else if (field.type === "url" && val) {
        let valid = false;
        try {
          valid = ["http:", "https:"].includes(new URL(val).protocol);
        } catch {}
        if (!valid)
          errors.push({
            field,
            message: "Enter a complete http:// or https:// link.",
          });
      }
    }
    function group(name, message) {
      const all = [...step.querySelectorAll('input[name="' + name + '"]')];
      if (all.length && !all.some((f) => f.checked))
        errors.push({ field: all[0], message });
    }
    if (n === 1) group("ageGroup", "Choose an age bracket.");
    if (n === 2) group("roles", "Choose at least one role.");
    if (n === 4) {
      if (selectedRoles().includes("programmer"))
        group("programmerWork", "Choose at least one programming area.");
      if (selectedRoles().includes("spriter"))
        group("spritingAbilities", "Choose at least one spriting area.");
    }
    return errors;
  }
  function renderErrors(errors) {
    clearErrors();
    const summary = document.getElementById("error-summary");
    errors.forEach(({ field, message }, i) => {
      const holder = field.closest(".field") || field.parentElement;
      holder.classList.add("has-error");
      field.setAttribute("aria-invalid", "true");
      if (!field.id) field.id = "answer-" + currentStep + "-" + i;
      const error = document.createElement("p");
      error.id = "validation-" + field.id;
      error.className = "field-error";
      error.textContent = message;
      holder.append(error);
      field.setAttribute(
        "aria-describedby",
        (
          (field.getAttribute("aria-describedby") || "") +
          " " +
          error.id
        ).trim(),
      );
      const li = document.createElement("li"),
        a = document.createElement("a");
      a.href = "#" + field.id;
      a.textContent = message;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        field.focus();
        field.scrollIntoView({ block: "center" });
      });
      li.append(a);
      summary.querySelector("ul").append(li);
    });
    summary.hidden = false;
    summary.focus();
    summary.scrollIntoView({ block: "start" });
  }
  function updateRoleSections() {
    const roles = selectedRoles();
    for (const section of form.querySelectorAll("[data-role-section]"))
      section.hidden = !roles.includes(section.dataset.roleSection);
    document.querySelector("[data-no-role-details]").hidden = roles.length > 0;
  }
  function showStep(n, push = true, focus = true) {
    currentStep = Math.max(1, Math.min(5, n));
    maxVisited = Math.max(maxVisited, currentStep);
    clearErrors();
    updateRoleSections();
    for (const step of steps)
      step.hidden = +step.dataset.formStep !== currentStep;
    for (const button of stepButtons) {
      const num = +button.dataset.stepJump;
      button.disabled = num > maxVisited;
      button.setAttribute(
        "aria-current",
        num === currentStep ? "step" : "false",
      );
      button.dataset.complete =
        num < maxVisited && errorsFor(num).length === 0 ? "true" : "false";
    }
    document.querySelector("[data-current-step-label]").textContent =
      "Section " + currentStep + " of " + totalSteps;
    const heading = document.querySelector("[data-current-step-title]");
    heading.textContent = stepFor(currentStep).dataset.stepTitle;
    document.querySelector("[data-back-step]").hidden = currentStep === 1;
    document.querySelector("[data-next-step]").hidden = currentStep === 5;
    document.querySelector("[data-submit-application]").hidden =
      currentStep !== 5;
    if (currentStep === 5) {
      buildReview();
      addReviewEdits();
    }
    if (push)
      history.pushState({ step: currentStep }, "", "#section-" + currentStep);
    if (focus) {
      heading.focus({ preventScroll: true });
      document.querySelector(".form-shell").scrollIntoView({ block: "start" });
    }
  }
  function checkedValues(name) {
    return Array.prototype.slice
      .call(form.querySelectorAll('input[name="' + name + '"]:checked'))
      .map(function (field) {
        return field.dataset.label || field.value;
      });
  }

  function valueOf(name) {
    var field = form.elements[name];
    if (!field) return "";
    if (field instanceof RadioNodeList) return field.value || "";
    return String(field.value || "").trim();
  }

  function addReviewRow(container, label, value) {
    if (!value || (Array.isArray(value) && value.length === 0)) return;
    var row = document.createElement("div");
    row.className = "review-row";
    row.dataset.reviewStep = reviewStep;
    var term = document.createElement("div");
    term.className = "review-term";
    term.textContent = label;
    var data = document.createElement("div");
    data.className = "review-value";
    data.textContent = Array.isArray(value) ? value.join(", ") : value;
    row.appendChild(term);
    row.appendChild(data);
    container.appendChild(row);
  }

  function buildReview() {
    var container = document.getElementById("review-list");
    if (!container) return;
    container.innerHTML = "";

    reviewStep = 1;
    addReviewRow(container, "Name", valueOf("name"));
    addReviewRow(container, "Timezone", valueOf("timezone"));
    addReviewRow(container, "Pronouns", valueOf("pronouns") || "Not provided");
    addReviewRow(container, "Age bracket", valueOf("ageGroup"));
    reviewStep = 3;
    addReviewRow(container, "Experience", valueOf("experience"));
    addReviewRow(container, "What interests you", valueOf("interest"));
    addReviewRow(container, "Critique", valueOf("critique"));
    addReviewRow(
      container,
      "Pokemon-related projects",
      valueOf("pokemonProjects") || "None provided",
    );
    addReviewRow(container, "Time commitment", valueOf("timeCommitment"));
    addReviewRow(
      container,
      "Anything else",
      valueOf("anythingElse") || "Nothing added",
    );
    reviewStep = 2;
    addReviewRow(container, "Roles", checkedValues("roles"));

    reviewStep = 4;
    if (selectedRoles().indexOf("programmer") !== -1) {
      addReviewRow(
        container,
        "Programming background",
        valueOf("programmingBackground"),
      );
      addReviewRow(
        container,
        "Essentials / RPG Maker XP familiarity",
        valueOf("essentialsFamiliarity"),
      );
      addReviewRow(
        container,
        "Programming interests",
        checkedValues("programmerWork"),
      );
      addReviewRow(
        container,
        "Programming examples",
        valueOf("programmerExamples"),
      );
    }
    if (selectedRoles().indexOf("move-animator") !== -1) {
      addReviewRow(
        container,
        "Move animation experience",
        valueOf("moveAnimationExperience"),
      );
      addReviewRow(
        container,
        "Move animation examples",
        valueOf("moveAnimationExamples"),
      );
    }
    if (selectedRoles().indexOf("spriter") !== -1) {
      addReviewRow(
        container,
        "Spriting areas",
        checkedValues("spritingAbilities"),
      );
      addReviewRow(
        container,
        "Spriting portfolio",
        valueOf("spriterPortfolio"),
      );
      addReviewRow(container, "Spriting styles", valueOf("spriterStyle"));
      addReviewRow(container, "Art experience", valueOf("spriterExperience"));
    }
    if (selectedRoles().indexOf("music") !== -1) {
      addReviewRow(container, "Music portfolio", valueOf("musicPortfolio"));
      addReviewRow(container, "Music styles", valueOf("musicStyle"));
      addReviewRow(container, "Music experience", valueOf("musicExperience"));
    }
  }

  function payload() {
    return {
      profile: {
        name: valueOf("name"),
        timezone: valueOf("timezone"),
        pronouns: valueOf("pronouns") || null,
        ageGroup: valueOf("ageGroup"),
      },
      general: {
        experience: valueOf("experience"),
        interest: valueOf("interest"),
        critique: valueOf("critique"),
        pokemonProjects: valueOf("pokemonProjects") || null,
        timeCommitment: valueOf("timeCommitment"),
        anythingElse: valueOf("anythingElse") || null,
      },
      roles: selectedRoles(),
      roleDetails: {
        programmer:
          selectedRoles().indexOf("programmer") !== -1
            ? {
                background: valueOf("programmingBackground"),
                essentialsFamiliarity: valueOf("essentialsFamiliarity"),
                interests: checkedValues("programmerWork"),
                examples: valueOf("programmerExamples") || null,
              }
            : null,
        moveAnimator:
          selectedRoles().indexOf("move-animator") !== -1
            ? {
                experience: valueOf("moveAnimationExperience"),
                examples: valueOf("moveAnimationExamples") || null,
              }
            : null,
        spriter:
          selectedRoles().indexOf("spriter") !== -1
            ? {
                abilities: checkedValues("spritingAbilities"),
                portfolio: valueOf("spriterPortfolio") || null,
                styleComfort: valueOf("spriterStyle"),
                experience: valueOf("spriterExperience") || null,
              }
            : null,
        music:
          selectedRoles().indexOf("music") !== -1
            ? {
                portfolio: valueOf("musicPortfolio") || null,
                styleComfort: valueOf("musicStyle"),
                experience: valueOf("musicExperience") || null,
              }
            : null,
      },
    };
  }

  function addReviewEdits() {
    const rows = [...document.querySelectorAll("#review-list .review-row")];
    const sections = [
      ["Your profile", 1],
      ["Roles", 2],
      ["Background", 3],
      ["Role questions", 4],
    ].map(([title, step]) => [
      title,
      step,
      rows.filter((row) => +row.dataset.reviewStep === step),
    ]);
    const parent = document.getElementById("review-list");
    parent.replaceChildren();
    for (const [title, step, items] of sections) {
      if (!items.length) continue;
      const group = document.createElement("section");
      group.className = "review-group";
      const bar = document.createElement("div");
      bar.className = "review-heading";
      const h = document.createElement("h3");
      h.textContent = title;
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "text-button";
      edit.textContent = "Edit";
      edit.setAttribute("aria-label", "Edit " + title.toLowerCase());
      edit.addEventListener("click", () => {
        showStep(step);
        saveDraft();
      });
      bar.append(h, edit);
      group.append(bar, ...items);
      parent.append(group);
    }
  }
  async function submitApplication() {
    if (currentStep !== totalSteps || submitting) return;
    for (let n = 1; n < 5; n++) {
      const errors = errorsFor(n);
      if (errors.length) {
        showStep(n);
        renderErrors(errors);
        return;
      }
    }
    const message = document.getElementById("submit-message"),
      button = document.querySelector("[data-submit-application]");
    const session = await helpers.loadSession();
    if (!session?.user) {
      message.className = "notice-strip error";
      message.innerHTML = 'Discord sign-in is required to submit your application. Please <a href="' + helpers.loginUrl(window.location.href) + '" class="text-link">sign in with Discord</a> to continue.';
      message.hidden = false;
      message.focus();
      return;
    }
    submitting = true;
    button.disabled = true;
    button.textContent = "Submitting…";
    message.hidden = true;
    try {
      const response = await fetch(helpers.apiBase + "/api/application", {
        method: "POST",
        credentials: "include",
        headers: helpers.getAuthHeaders
          ? helpers.getAuthHeaders({
              "Content-Type": "application/json",
              Accept: "application/json",
            })
          : {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
        body: JSON.stringify(payload()),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          result.message ||
            "Your application could not be submitted. Your answers are still here.",
        );
      storage.clear();
      dirty = false;
      message.className = "notice-strip success";
      message.textContent =
        "Application submitted. You can check its progress in My application.";
      message.hidden = false;
      document.querySelector("[data-after-preview]").hidden = false;
      for (const control of form.querySelectorAll(
        "input,textarea,select,button",
      ))
        control.disabled = true;
      for (const b of stepButtons) b.disabled = true;
      document.querySelector("[data-draft-state]").textContent =
        "Application submitted.";
    } catch (error) {
      message.className = "notice-strip error";
      message.textContent = error.message;
      message.hidden = false;
      button.disabled = false;
      button.textContent = "Submit application";
    } finally {
      submitting = false;
      message.focus();
    }
  }
  document.querySelector("[data-next-step]").addEventListener("click", () => {
    const errors = errorsFor(currentStep);
    if (errors.length) return renderErrors(errors);
    showStep(currentStep + 1);
    saveDraft();
  });
  document.querySelector("[data-back-step]").addEventListener("click", () => {
    showStep(currentStep - 1);
    saveDraft();
  });
  for (const button of stepButtons)
    button.addEventListener("click", () => {
      if (+button.dataset.stepJump <= maxVisited) {
        showStep(+button.dataset.stepJump);
        saveDraft();
      }
    });
  document
    .querySelector("[data-submit-application]")
    .addEventListener("click", submitApplication);
  form.addEventListener("submit", (e) => e.preventDefault());
  form.addEventListener("input", () => {
    dirty = true;
    previewFinished = false;
    saveDraft();
    document.getElementById("submit-message").hidden = true;
    document.querySelector("[data-after-preview]").hidden = true;
  });
  for (const input of form.querySelectorAll('input[name="roles"]'))
    input.addEventListener("change", () => {
      updateRoleSections();
      saveDraft();
    });
  for (const field of form.querySelectorAll("input[id],textarea[id]")) {
    const hint = field.closest(".field")?.querySelector(".field-help");
    if (hint) {
      hint.id = "hint-" + field.id;
      field.setAttribute("aria-describedby", hint.id);
    }
  }
  const draft = storage.read();
  if (draft?.version === 1 && draft.values) {
    previewFinished = !!draft.previewComplete;
    for (const field of form.querySelectorAll("[name]")) {
      const value = draft.values[field.name];
      if (Array.isArray(value)) field.checked = value.includes(field.value);
      else if (typeof value === "string") field.value = value;
    }
    maxVisited = Math.min(5, Math.max(1, +draft.maxVisited || 1));
    currentStep = Math.min(maxVisited, Math.max(1, +draft.step || 1));
    document.querySelector("[data-draft-state]").textContent =
      "Draft restored in this tab. Nothing sent.";
  }
  const role = new URLSearchParams(location.search).get("role");
  const requested = [...form.querySelectorAll('input[name="roles"]')].find(
    (f) => f.value === role,
  );
  if (requested) {
    requested.checked = true;
    currentStep = 1;
  }
  document.querySelector("[data-submit-application]").textContent =
    helpers.apiBase ? "Submit application" : "Finish preview";
  document.querySelector("[data-clear-draft]").addEventListener("click", () => {
    document.querySelector("[data-draft-confirm]").hidden = false;
    document.querySelector("[data-cancel-clear]").focus();
  });
  document
    .querySelector("[data-cancel-clear]")
    .addEventListener("click", () => {
      document.querySelector("[data-draft-confirm]").hidden = true;
      document.querySelector("[data-clear-draft]").focus();
    });
  document
    .querySelector("[data-confirm-clear]")
    .addEventListener("click", () => {
      document.querySelector("[data-draft-confirm]").hidden = true;
      storage.clear();
      form.reset();
      dirty = false;
      previewFinished = false;
      maxVisited = 1;
      history.replaceState({ step: 1 }, "", location.pathname);
      showStep(1, false);
      document.querySelector("[data-draft-state]").textContent =
        "Draft cleared. Nothing sent.";
      document.getElementById("submit-message").hidden = true;
      document.querySelector("[data-after-preview]").hidden = true;
    });
  addEventListener("popstate", () => {
    const match = location.hash.match(/^#section-([1-5])$/);
    showStep(Math.min(match ? +match[1] : 1, maxVisited), false);
    saveDraft();
  });
  addEventListener("beforeunload", (e) => {
    if (dirty && !saveDraft()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  if (!helpers.apiBase) {
    document.querySelector("[data-submit-explanation]").textContent =
      "Finish preview checks your answers and keeps your draft in this tab. Nothing will be sent.";
    stepFor(5).dataset.stepTitle = "Review your answers";
  }
  showStep(currentStep, false, false);
  history.replaceState(
    { step: currentStep },
    "",
    location.pathname + "#section-" + currentStep,
  );
})();
