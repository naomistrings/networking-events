import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const form = document.getElementById("eventForm");
const addEventSection = document.getElementById("addEventSection");
const toggleFormBtn = document.getElementById("toggleFormBtn");
const eventsList = document.getElementById("eventsList");
const eventsCards = document.getElementById("eventsCards");
const lastWeekList = document.getElementById("lastWeekList");
const pastCommentedList = document.getElementById("pastCommentedList");
const viewPastCommentedLink = document.getElementById("viewPastCommentedLink");
const pastCommentedSection = document.getElementById("pastCommentedSection");
const formMessage = document.getElementById("formMessage");
const listMessage = document.getElementById("listMessage");
const submitBtn = document.getElementById("submitBtn");

function startOfTodayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function sevenDaysAgoISO() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function formatDateTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatDayLabel(date) {
  const weekday = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
  }).format(date);
  const month = new Intl.DateTimeFormat(undefined, { month: "short" }).format(
    date
  );
  return `${weekday} ${month} ${date.getDate()}`;
}

function formatTimeParts(date) {
  const parts = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);

  let time = "";
  let dayPeriod = "";
  parts.forEach((part) => {
    if (part.type === "dayPeriod") {
      dayPeriod = part.value;
    } else {
      time += part.value;
    }
  });

  return { time: time.trim(), dayPeriod };
}

function appendTimeWithAmPm(container, date) {
  const { time, dayPeriod } = formatTimeParts(date);
  container.appendChild(document.createTextNode(time));
  if (dayPeriod) {
    const ampm = document.createElement("span");
    ampm.className = "ampm";
    ampm.textContent = ` ${dayPeriod}`;
    container.appendChild(ampm);
  }
}

function buildEventDateCell(startIso, endIso) {
  const cell = document.createElement("div");
  cell.className = "event-date-cell";
  const start = new Date(startIso);

  const dayLine = document.createElement("div");
  dayLine.className = "event-date-day";
  dayLine.textContent = formatDayLabel(start);
  cell.appendChild(dayLine);

  const timeLine = document.createElement("div");
  timeLine.className = "event-date-time";
  appendTimeWithAmPm(timeLine, start);

  if (endIso) {
    const end = new Date(endIso);
    const sameDay = start.toDateString() === end.toDateString();
    timeLine.appendChild(document.createTextNode(sameDay ? "–" : " – "));
    if (!sameDay) {
      timeLine.appendChild(
        document.createTextNode(`${formatDayLabel(end)}, `)
      );
    }
    appendTimeWithAmPm(timeLine, end);
  }

  cell.appendChild(timeLine);
  return cell;
}

async function loadEvents() {
  listMessage.textContent = "Loading upcoming events...";
  eventsList.innerHTML = "";
  eventsCards.innerHTML = "";
  lastWeekList.innerHTML = "";
  pastCommentedList.innerHTML = "";

  const [
    { data: upcomingEvents, error: upcomingError },
    { data: lastWeekEvents, error: lastWeekError },
  ] = await Promise.all([
    supabase
      .from("events")
      .select("*")
      .gte("event_at", startOfTodayISO())
      .order("event_at", { ascending: true }),
    supabase
      .from("events")
      .select("*")
      .gte("event_at", sevenDaysAgoISO())
      .lt("event_at", startOfTodayISO())
      .order("event_at", { ascending: false }),
  ]);

  if (upcomingError || lastWeekError) {
    listMessage.textContent = "Error loading events.";
    console.error(upcomingError || lastWeekError);
    return;
  }

  const commentMap = {};
  if (lastWeekEvents && lastWeekEvents.length > 0) {
    const eventIds = lastWeekEvents.map((event) => event.id);
    const { data: comments, error: commentError } = await supabase
      .from("event_comments")
      .select("*")
      .in("event_id", eventIds)
      .order("created_at", { ascending: false });

    if (commentError) {
      console.warn("Unable to load last-week comments:", commentError);
    } else if (comments) {
      comments.forEach((comment) => {
        if (!commentMap[comment.event_id]) {
          commentMap[comment.event_id] = comment;
        }
      });
    }
  }

  const { data: pastComments, error: pastCommentsError } = await supabase
    .from("event_comments")
    .select("*, events(*)")
    .order("created_at", { ascending: false });

  if (pastCommentsError) {
    console.warn("Unable to load past commented events:", pastCommentsError);
  }

  const pastCommentedEvents = [];
  const pastCommentMap = {};
  const seenPastEventIds = new Set();
  (pastComments || []).forEach((comment) => {
    if (
      !comment.events ||
      new Date(comment.events.event_at) >= new Date(startOfTodayISO()) ||
      seenPastEventIds.has(comment.event_id)
    ) {
      return;
    }
    seenPastEventIds.add(comment.event_id);
    pastCommentedEvents.push(comment.events);
    pastCommentMap[comment.event_id] = comment;
  });

  listMessage.textContent = "";

  if (!upcomingEvents || upcomingEvents.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No upcoming events — you can add one above.";
    eventsCards.appendChild(empty);
  } else {
    upcomingEvents.forEach((event) => {
      renderEventRow(event);
      renderEventCard(event);
    });
  }

  renderCommentTable(
    lastWeekEvents,
    commentMap,
    lastWeekList,
    "No events from last week."
  );

  renderCommentTable(
    pastCommentedEvents,
    pastCommentMap,
    pastCommentedList,
    "No past commented events yet."
  );
}

function renderCommentTable(events, commentMap, container, emptyMessage) {
  container.innerHTML = "";

  if (!events || events.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = emptyMessage;
    container.appendChild(empty);
    return;
  }

  const tableWrapper = document.createElement("div");
  tableWrapper.className = "theme-card";
  const table = document.createElement("table");
  table.className = "events-table";
  const thead = document.createElement("thead");
  thead.innerHTML = `<tr><th>Date</th><th>Event</th><th>Location</th><th>Price</th></tr>`;
  const tbody = document.createElement("tbody");
  table.appendChild(thead);
  table.appendChild(tbody);
  tableWrapper.appendChild(table);
  container.appendChild(tableWrapper);

  events.forEach((event) => {
    renderEventCommentRow(event, commentMap[event.id], tbody);
  });
}

function renderEventRow(event) {
  const tr = document.createElement("tr");
  const tdDate = document.createElement("td");
  tdDate.appendChild(buildEventDateCell(event.event_at, event.event_end_at));
  const tdEvent = document.createElement("td");
  if (event.event_url) {
    const a = document.createElement("a");
    a.href = event.event_url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = event.event_name;
    tdEvent.appendChild(a);
  } else {
    tdEvent.textContent = event.event_name;
  }

  const tdLocation = document.createElement("td");
  tdLocation.textContent = event.location || "";
  const tdPrice = document.createElement("td");
  tdPrice.textContent = event.price || "";

  tr.appendChild(tdDate);
  tr.appendChild(tdEvent);
  tr.appendChild(tdLocation);
  tr.appendChild(tdPrice);
  eventsList.appendChild(tr);
}

function renderEventCard(event) {
  const card = document.createElement("div");
  card.className = "event-card";
  const title = document.createElement("div");
  title.className = "event-card__title";
  if (event.event_url) {
    const a = document.createElement("a");
    a.href = event.event_url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = event.event_name;
    title.appendChild(a);
  } else {
    title.textContent = event.event_name;
  }

  const dateCell = buildEventDateCell(event.event_at, event.event_end_at);
  dateCell.classList.add("event-card__date");

  const meta = document.createElement("div");
  meta.className = "event-card__meta";
  meta.textContent = `${event.location || "Online"} • ${event.price || ""}`;

  card.appendChild(title);
  card.appendChild(dateCell);
  card.appendChild(meta);
  eventsCards.appendChild(card);
}

function renderEventCommentRow(event, comment, tbody) {
  const row = document.createElement("tr");
  const tdDate = document.createElement("td");
  tdDate.appendChild(buildEventDateCell(event.event_at, event.event_end_at));

  const tdEvent = document.createElement("td");
  const titleGroup = document.createElement("div");
  titleGroup.className = "event-row-title-group";

  const titleText = document.createElement("div");
  titleText.className = "event-row-title";
  if (event.event_url) {
    const a = document.createElement("a");
    a.href = event.event_url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = event.event_name;
    titleText.appendChild(a);
  } else {
    titleText.textContent = event.event_name;
  }
  titleGroup.appendChild(titleText);

  const buttonRow = document.createElement("div");
  buttonRow.className = "event-row-button-row";
  const commentBtn = document.createElement("button");
  commentBtn.className = "theme-btn theme-btn--sm theme-btn--outline";
  commentBtn.type = "button";
  commentBtn.textContent = "Comment + Save";
  buttonRow.appendChild(commentBtn);
  titleGroup.appendChild(buttonRow);

  if (comment?.comment_text) {
    const savedText = document.createElement("div");
    savedText.className = "event-comment-text";
    savedText.textContent = comment.comment_text;
    titleGroup.appendChild(savedText);
  }

  tdEvent.appendChild(titleGroup);

  const tdLocation = document.createElement("td");
  tdLocation.textContent = event.location || "";

  const tdPrice = document.createElement("td");
  tdPrice.textContent = event.price || "";

  row.appendChild(tdDate);
  row.appendChild(tdEvent);
  row.appendChild(tdLocation);
  row.appendChild(tdPrice);
  tbody.appendChild(row);

  const commentRow = document.createElement("tr");
  commentRow.className = "comment-row hidden";
  const commentTd = document.createElement("td");
  commentTd.colSpan = 4;
  const commentPanel = document.createElement("div");
  commentPanel.className = "comment-panel comment-row-panel";

  const textarea = document.createElement("textarea");
  textarea.className = "comment-input";
  textarea.placeholder = "Add your notes here...";
  textarea.value = comment?.comment_text || "";

  const actions = document.createElement("div");
  actions.className = "comment-actions";
  const saveBtn = document.createElement("button");
  saveBtn.className = "theme-btn theme-btn--sm";
  saveBtn.type = "button";
  saveBtn.textContent = "Save comment";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "theme-btn theme-btn--sm theme-btn--outline";
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);

  commentPanel.appendChild(textarea);
  commentPanel.appendChild(actions);
  commentTd.appendChild(commentPanel);
  commentRow.appendChild(commentTd);
  tbody.appendChild(commentRow);

  commentBtn.addEventListener("click", () => {
    commentRow.classList.toggle("hidden");
  });

  cancelBtn.addEventListener("click", () => {
    textarea.value = comment?.comment_text || "";
    commentRow.classList.add("hidden");
  });

  saveBtn.addEventListener("click", async () => {
    await saveCommentForEvent(event.id, textarea.value.trim());
    commentRow.classList.add("hidden");
    await loadEvents();
  });
}

async function saveCommentForEvent(eventId, text) {
  if (!text) {
    return;
  }

  const { data: existingComments, error: fetchError } = await supabase
    .from("event_comments")
    .select("id")
    .eq("event_id", eventId)
    .limit(1);

  if (fetchError) {
    console.warn("Could not check existing comment:", fetchError);
  }

  if (existingComments && existingComments.length > 0) {
    const { error: updateError } = await supabase
      .from("event_comments")
      .update({ comment_text: text })
      .eq("id", existingComments[0].id);

    if (updateError) {
      console.error("Failed to update comment:", updateError);
    }
  } else {
    const { error: insertError } = await supabase
      .from("event_comments")
      .insert([{ event_id: eventId, comment_text: text }]);

    if (insertError) {
      console.error("Failed to save comment:", insertError);
    }
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  formMessage.textContent = "";

  const honeypot = document.getElementById("website").value;
  if (honeypot) {
    return;
  }

  const eventName = document.getElementById("eventName").value.trim();
  const eventUrl = document.getElementById("eventUrl").value.trim();
  const eventAtRaw = document.getElementById("eventAt").value;
  const eventEndAtRaw = document.getElementById("eventEndAt").value;
  const location = document.getElementById("location").value.trim();
  const price = document.getElementById("price").value.trim();

  if (!eventName || !eventAtRaw) {
    formMessage.className = "theme-text-error";
    formMessage.textContent =
      "Please enter the required fields: name and date/time.";
    return;
  }

  const eventAt = new Date(eventAtRaw);
  if (isNaN(eventAt.getTime())) {
    formMessage.className = "theme-text-error";
    formMessage.textContent = "Please enter a valid date and time.";
    return;
  }

  let eventEndAt = null;
  if (eventEndAtRaw) {
    eventEndAt = new Date(eventEndAtRaw);
    if (isNaN(eventEndAt.getTime())) {
      formMessage.className = "theme-text-error";
      formMessage.textContent = "Please enter a valid end date and time.";
      return;
    }
    if (eventEndAt <= eventAt) {
      formMessage.className = "theme-text-error";
      formMessage.textContent = "End time must be after the start time.";
      return;
    }
  }

  submitBtn.disabled = true;
  submitBtn.classList.add("theme-btn--loading");

  const payload = {
    event_name: eventName,
    event_url: eventUrl || null,
    event_at: eventAt.toISOString(),
    event_end_at: eventEndAt ? eventEndAt.toISOString() : null,
    location: location || null,
    price: price || null,
  };

  const { error } = await supabase.from("events").insert([payload]);

  submitBtn.disabled = false;
  submitBtn.classList.remove("theme-btn--loading");

  if (error) {
    formMessage.className = "theme-text-error";
    const message = error.message || error.details || JSON.stringify(error);
    formMessage.textContent = `Failed to submit — ${message}`;
    console.error("Supabase insert error:", error);
    return;
  }

  formMessage.className = "theme-text-success";
  formMessage.textContent = "Thanks — your event was submitted.";

  form.reset();
  await loadEvents();

  setTimeout(() => {
    formMessage.textContent = "";
  }, 4000);
});

toggleFormBtn.addEventListener("click", () => {
  const isHidden = addEventSection.classList.toggle("hidden");
  toggleFormBtn.textContent = isHidden ? "Add an event" : "Hide form";
});

viewPastCommentedLink.addEventListener("click", (event) => {
  event.preventDefault();
  const isHidden = pastCommentedSection.classList.toggle("hidden");
  viewPastCommentedLink.textContent = isHidden
    ? "View past events with comments"
    : "Hide past events";
  if (!isHidden) {
    pastCommentedSection.scrollIntoView({ behavior: "smooth" });
  }
});

loadEvents();
