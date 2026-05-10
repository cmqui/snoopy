function onHomepage() {
  var items = fetchMessages_();
  var section = CardService.newCardSection();

  if (!items.length) {
    section.addWidget(
      CardService.newTextParagraph().setText('No tracked emails yet.')
    );
  } else {
    items.slice(0, 10).forEach(function(item) {
      section.addWidget(
        CardService.newDecoratedText()
          .setText(item.subject || '(No subject)')
          .setBottomLabel(formatSummary_(item))
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('showMessageDetail')
              .setParameters({ messageId: item.id })
          )
      );
    });
  }

  return CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Snoopy')
    )
    .addSection(section)
    .build();
}

function onContextual(e) {
  var trackedDetail = findTrackedMessageForCurrentContext_(e);
  if (!trackedDetail) {
    return onHomepage();
  }

  return buildMessageDetailCard_(trackedDetail);
}

function onCompose(e) {
  var extractedSubject = getComposeSubject_(e);
  var section = CardService.newCardSection()
    .addWidget(
      CardService.newTextParagraph()
        .setText('Apply tracking to the current draft. Snoopy appends hidden tracking pixels to the draft body. Accurate per-recipient attribution requires one recipient per sent message.')
    )
    .addWidget(
      CardService.newTextInput()
        .setFieldName('subjectInput')
        .setTitle('Subject')
        .setHint('Enter the email subject to store in Snoopy')
        .setValue(extractedSubject)
    )
    .addWidget(
      CardService.newTextButton()
        .setText('Apply tracking')
        .setOnClickAction(CardService.newAction().setFunctionName('applyTrackingToDraft'))
    );

  var recipients = getComposeRecipients_(e);
  if (!recipients.length) {
    section.addWidget(
      CardService.newTextParagraph().setText('Add at least one To or Cc recipient before applying tracking.')
    );
  } else {
    section.addWidget(
      CardService.newDecoratedText()
        .setTopLabel('Recipients')
        .setText(recipients.map(function(recipient) {
          return recipient.email;
        }).join(', '))
    );
  }

  return [CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Snoopy Tracking'))
    .addSection(section)
    .build()];
}

function applyTrackingToDraft(e) {
  var recipients = getComposeRecipients_(e);
  var subject = getFormInputValue_(e, 'subjectInput') || getComposeSubject_(e);
  if (!recipients.length) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText('Add at least one To or Cc recipient before applying tracking.')
      )
      .build();
  }

  var prepareResponse = callBackend_('/api/v1/messages/prepare', 'post', {
    subject: subject,
    htmlBody: '<!-- snoopy-tracking -->',
    recipients: recipients,
    draftContextType: e.gmail && e.gmail.threadId ? 'reply' : 'new',
    gmailThreadId: e.gmail && e.gmail.threadId ? e.gmail.threadId : null
  });

  var appendedMarkup = prepareResponse.instrumentedHtmlBody.replace('<!-- snoopy-tracking -->', '');
  callBackend_('/api/v1/messages/mark-sent', 'post', {
    trackedMessageId: prepareResponse.trackedMessageId,
    gmailThreadId: e.gmail && e.gmail.threadId ? e.gmail.threadId : null,
    recipients: recipients
  });

  return CardService.newUpdateDraftActionResponseBuilder()
    .setUpdateDraftBodyAction(
      CardService.newUpdateDraftBodyAction()
        .addUpdateContent(appendedMarkup, CardService.ContentType.MUTABLE_HTML)
        .setUpdateType(CardService.UpdateDraftBodyType.INSERT_AT_END)
    )
    .build();
}

function showMessageDetail(e) {
  var messageId = e.parameters.messageId;
  var detail = fetchMessageDetail_(messageId);
  return buildMessageDetailResponse_(detail);
}

function showIpLog(e) {
  var messageId = e.parameters.messageId;
  var detail = fetchMessageDetail_(messageId);
  var events = collectEventsForMessage_(detail);
  var section = CardService.newCardSection();

  if (!events.length) {
    section.addWidget(
      CardService.newTextParagraph().setText('No IPs logged yet.')
    );
  } else {
    events.forEach(function(event) {
      var prefix = event.deliveryPath === 'gmail_proxy' ? '* ' : '';
      var ipDisplay = event.deliveryPath === 'gmail_proxy'
        ? escapeHtml_(prefix + event.ip)
        : '<a href="https://iplocation.io/ip/' + encodeURIComponent(event.ip) + '">' + escapeHtml_(event.ip) + '</a>';
      section.addWidget(
        CardService.newTextParagraph()
          .setText(ipDisplay + '<br>Logged at: ' + escapeHtml_(event.occurredAt))
      );
    });
    section.addWidget(
      CardService.newTextParagraph()
        .setText('* likely Google proxy request')
    );
  }

  var nav = CardService.newNavigation().pushCard(
    CardService.newCardBuilder()
      .setHeader(CardService.newCardHeader().setTitle('Logged IPs'))
      .addSection(section)
      .build()
  );

  return CardService.newActionResponseBuilder().setNavigation(nav).build();
}

function buildMessageDetailResponse_(detail) {
  var nav = CardService.newNavigation().pushCard(buildMessageDetailCard_(detail));
  return CardService.newActionResponseBuilder().setNavigation(nav).build();
}

function buildMessageDetailCard_(detail) {
  var subject = detail.message.subject || '(No subject)';
  var section = CardService.newCardSection();

  detail.recipients.forEach(function(recipient) {
    var countedEvents = (recipient.events || []).filter(function(event) {
      return event.disposition === 'counted';
    });
    var unconfirmedEvents = (recipient.events || []).filter(function(event) {
      return event.disposition === 'unconfirmed_gmail_proxy_activity';
    });
    section.addWidget(
      CardService.newDecoratedText()
        .setText(buildRecipientHeadline_(countedEvents.length, unconfirmedEvents.length, recipient.confidencePercent))
        .setBottomLabel(buildRecipientLabel_(recipient, countedEvents, unconfirmedEvents))
    );
  });

  section.addWidget(
    CardService.newTextButton()
      .setText('View logged IPs')
      .setOnClickAction(
        CardService.newAction()
          .setFunctionName('showIpLog')
          .setParameters({ messageId: detail.message.id })
      )
  );

  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle(subject))
    .addSection(section)
    .build();
}

function fetchMe_() {
  return callBackend_('/api/v1/me', 'get');
}

function fetchMessages_() {
  return callBackend_('/api/v1/messages', 'get').items || [];
}

function fetchMessageDetail_(messageId) {
  return callBackend_('/api/v1/messages/' + encodeURIComponent(messageId), 'get');
}

function fetchTrackedMessageForThread_(threadId) {
  return callBackend_('/api/v1/threads/' + encodeURIComponent(threadId) + '/message', 'get');
}

function findTrackedMessageForCurrentContext_(e) {
  var directMessageId = extractTrackedMessageIdFromCurrentMessage_(e);
  if (directMessageId) {
    return fetchMessageDetail_(directMessageId);
  }

  var threadId = e && e.gmail && e.gmail.threadId;
  if (!threadId) {
    return null;
  }

  var lookup = fetchTrackedMessageForThread_(threadId);
  return lookup.message || null;
}

function extractTrackedMessageIdFromCurrentMessage_(e) {
  if (!e || !e.gmail || !e.gmail.accessToken || !e.gmail.messageId) {
    return null;
  }

  GmailApp.setCurrentMessageAccessToken(e.gmail.accessToken);
  var message = GmailApp.getMessageById(e.gmail.messageId);
  if (!message) {
    return null;
  }

  var body = message.getBody();
  var match = body && body.match(/\/t\/([^"']+)\.gif/);
  if (!match || !match[1]) {
    return null;
  }

  return decodeTrackedMessageIdFromPixelToken_(decodeURIComponent(match[1]));
}

function decodeTrackedMessageIdFromPixelToken_(signedToken) {
  var payloadSegment = signedToken.split('.')[0];
  if (!payloadSegment) {
    return null;
  }

  try {
    var payloadJson = Utilities.newBlob(Utilities.base64DecodeWebSafe(payloadSegment)).getDataAsString();
    var payload = JSON.parse(payloadJson);
    return payload.trackedMessageId || null;
  } catch (error) {
    return null;
  }
}

function callBackend_(path, method, body) {
  var token = ScriptApp.getIdentityToken();
  if (!token) {
    throw new Error('Missing identity token. Ensure openid/email scopes are enabled.');
  }

  var response = UrlFetchApp.fetch(getApiBaseUrl_() + path, {
    method: method,
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + token
    },
    muteHttpExceptions: true,
    payload: body ? JSON.stringify(body) : undefined
  });

  var statusCode = response.getResponseCode();
  var text = response.getContentText();
  var parsed = text ? JSON.parse(text) : {};
  if (statusCode >= 400) {
    throw new Error(parsed.error || ('Backend request failed with status ' + statusCode));
  }

  return parsed;
}

function getApiBaseUrl_() {
  var value = PropertiesService.getScriptProperties().getProperty('SNOOPY_API_BASE_URL');
  if (!value) {
    throw new Error('Missing script property SNOOPY_API_BASE_URL');
  }
  return value.replace(/\/$/, '');
}

function getComposeRecipients_(e) {
  var gmail = e.gmail || {};
  var toRecipients = normalizeComposeRecipients_(gmail.toRecipients || [], 'to');
  var ccRecipients = normalizeComposeRecipients_(gmail.ccRecipients || [], 'cc');
  return toRecipients.concat(ccRecipients);
}

function normalizeComposeRecipients_(entries, recipientType) {
  return entries
    .map(function(entry) {
      return typeof entry === 'string' ? entry : entry.email;
    })
    .filter(Boolean)
    .map(function(email) {
      return {
        email: String(email).trim().toLowerCase(),
        recipientType: recipientType
      };
    });
}

function formatSummary_(item) {
  var parts = [
    'Status: ' + item.status,
    'Confidence: ' + colorizeConfidence_(item.confidencePercent),
    'Recipients with counted activity: ' + item.openedRecipientCount + '/' + item.recipientCount
  ];
  if (item.unconfirmedRecipientCount) {
    parts.push('Recipients with unconfirmed proxy activity: ' + item.unconfirmedRecipientCount);
  }
  return parts.join(' • ');
}

function buildRecipientHeadline_(countedCount, unconfirmedCount, confidencePercent) {
  if (countedCount > 0) {
    return 'Likely opened: ' + colorizeConfidence_(confidencePercent) + ' confidence';
  }
  if (unconfirmedCount > 0) {
    return 'Unconfirmed proxy activity: ' + colorizeConfidence_(confidencePercent) + ' confidence';
  }
  return 'No tracked activity yet: ' + colorizeConfidence_(confidencePercent) + ' confidence';
}

function buildRecipientLabel_(recipient, countedEvents, unconfirmedEvents) {
  var parts = [
    'First counted activity: ' + escapeHtml_(recipient.firstOpenedAt || 'Not yet'),
    'Last counted activity: ' + escapeHtml_(recipient.lastOpenedAt || 'Not yet'),
    'Last counted IP: ' + escapeHtml_(recipient.lastOpenIp || 'Not yet')
  ];
  if (unconfirmedEvents.length) {
    parts.push('Unconfirmed Gmail proxy activity: ' + escapeHtml_(String(unconfirmedEvents.length)));
  }
  var ignoredEvents = (recipient.events || []).filter(function(event) {
    return event.disposition === 'ignored_sender_or_prefetch';
  });
  if (ignoredEvents.length) {
    parts.push('Ignored likely sender/proxy fetches: ' + escapeHtml_(String(ignoredEvents.length)));
  }
  return parts.join('<br>');
}

function getComposeSubject_(e) {
  var gmail = e.gmail || {};
  return gmail.subject || (gmail.draftMetadata && gmail.draftMetadata.subject) || '';
}

function getFormInputValue_(e, fieldName) {
  var inputs = e.commonEventObject && e.commonEventObject.formInputs;
  var input = inputs && inputs[fieldName];
  var stringInputs = input && input.stringInputs;
  var values = stringInputs && stringInputs.value;
  return values && values.length ? values[0] : '';
}

function collectEventsForMessage_(detail) {
  var events = [];
  (detail.recipients || []).forEach(function(recipient) {
    (recipient.events || []).forEach(function(event) {
      events.push(event);
    });
  });

  events.sort(function(a, b) {
    return String(b.occurredAt).localeCompare(String(a.occurredAt));
  });

  return events;
}

function colorizeConfidence_(confidencePercent) {
  var color = '#B3261E';
  if (confidencePercent >= 90) {
    color = '#188038';
  } else if (confidencePercent >= 70) {
    color = '#B06000';
  } else if (confidencePercent >= 40) {
    color = '#C26401';
  }

  return '<font color="' + color + '"><b>' + confidencePercent + '%</b></font>';
}

function escapeHtml_(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
