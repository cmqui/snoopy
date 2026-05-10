function onHomepage() {
  var me = fetchMe_();
  var items = fetchMessages_();
  var section = CardService.newCardSection()
    .addWidget(
      CardService.newDecoratedText()
        .setTopLabel('Signed in')
        .setText(me.email)
        .setBottomLabel('Allowlisted access confirmed.')
    )
    .addWidget(
      CardService.newTextParagraph()
        .setText('Tracked opens use remote images. Gmail may proxy image requests, so logged IPs can belong to Google instead of the recipient.')
    );

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
        .setSubtitle('Tracked Gmail opens')
    )
    .addSection(section)
    .build();
}

function onContextual() {
  return onHomepage();
}

function onCompose(e) {
  var section = CardService.newCardSection()
    .addWidget(
      CardService.newTextParagraph()
        .setText('Apply tracking to the current draft. Snoopy appends hidden tracking pixels to the draft body. Accurate per-recipient attribution requires one recipient per sent message.')
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
  if (!recipients.length) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText('Add at least one To or Cc recipient before applying tracking.')
      )
      .build();
  }

  var prepareResponse = callBackend_('/api/v1/messages/prepare', 'post', {
    subject: '',
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
  var section = CardService.newCardSection()
    .addWidget(
      CardService.newDecoratedText()
        .setTopLabel('Subject')
        .setText(detail.message.subject || '(No subject)')
        .setBottomLabel('Status: ' + detail.message.status)
    );

  detail.recipients.forEach(function(recipient) {
    section.addWidget(
      CardService.newDecoratedText()
        .setTopLabel(recipient.email + ' (' + recipient.recipientType.toUpperCase() + ')')
        .setText('Opened ' + recipient.openCount + ' time(s)')
        .setBottomLabel(buildRecipientLabel_(recipient))
    );
  });

  var nav = CardService.newNavigation().pushCard(
    CardService.newCardBuilder()
      .setHeader(CardService.newCardHeader().setTitle('Tracked email'))
      .addSection(section)
      .build()
  );

  return CardService.newActionResponseBuilder().setNavigation(nav).build();
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
  return [
    'Status: ' + item.status,
    'Recipients: ' + item.openedRecipientCount + '/' + item.recipientCount + ' opened'
  ].join(' • ');
}

function buildRecipientLabel_(recipient) {
  var parts = [
    'First open: ' + (recipient.firstOpenedAt || 'Not yet'),
    'Last open IP: ' + (recipient.lastOpenIp || 'Not yet')
  ];
  return parts.join(' • ');
}
