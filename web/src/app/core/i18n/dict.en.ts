import type { Dict } from './dict.ms';
import type { GapCtx } from './gap-text';

// 英语词典：只覆盖屏 1–4。声明为 Dict，缺键或多键都编译不过。
export const en: Dict = {
  lang: {
    code: 'EN',
    switchLabel: 'Switch language to Bahasa Malaysia',
  },
  common: {
    loading: 'Loading…',
    retry: 'Try again',
    back: 'Back',
    close: 'Close',
  },
  titles: {
    login: 'Log in',
    plots: 'My land',
    newDocs: 'New land · Photo documents',
    camera: 'Take a photo',
    map: 'New land · Draw your land',
    review: 'New land · Review',
    result: 'Result',
    issue: 'Issue details',
    checking: 'Checking',
    coop: 'Cooperative dashboard',
  },
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  status: {
    green: 'Complete',
    yellow: 'Needs review',
    red: 'Action needed',
    needs_review: 'Officer to review',
    pending: 'Not started',
    unknown: 'Unknown',
  },
  login: {
    title: 'Log in',
    lead: 'Enter your phone number. No password needed.',
    phoneLabel: 'Phone number',
    phonePlaceholder: '+60 12-345 6789',
    hint: "We'll text you a 6-digit code.",
    send: 'Send OTP code',
    sending: 'Sending…',
    codeTitle: 'Enter the code',
    codeLead: (phone: string) => `We sent a 6-digit code to ${phone}.`,
    codeLabel: 'OTP code',
    confirm: 'Verify and log in',
    confirming: 'Verifying…',
    resend: 'Send the code again',
    resendIn: (seconds: number) => `Send again in ${seconds}s`,
    changeNumber: 'Change phone number',
    errors: {
      phoneEmpty: 'Please enter your phone number.',
      phoneFormat: "That phone number doesn't look right. Try something like 012-345 6789.",
      codeFormat: 'Please enter the 6-digit code from the SMS.',
      codeWrong: "That code isn't right. Check your SMS and try again.",
      codeExpired: 'That code has expired. Tap Send the code again.',
      tooMany: 'Too many attempts. Please try again in a moment.',
      network: 'No connection. Check your internet and try again.',
      notConfigured: 'This service is not set up yet.',
      generic: 'Something went wrong. Please try again in a moment.',
    },
  },
  plots: {
    title: 'My land',
    ownerHeader: (name: string, count: number) =>
      `${name} · ${count} ${count === 1 ? 'plot' : 'plots'}`,
    memberTitle: (name: string) => `Land of ${name}`,
    add: 'Add land',
    logout: 'Log out',
    loggingOut: 'Logging out…',
    logoutFailed: "Couldn't log out. Please try again.",
    lot: (lot: string, district: string) => (district ? `Lot ${lot}, ${district}` : `Lot ${lot}`),
    newLot: 'New lot',
    notFilled: 'Not filled in',
    areaHa: (ha: string) => `${ha} ha`,
    loadingPlots: 'Loading your land…',
    offline: 'No connection to the database. Check your internet and try again.',
    error: "Couldn't load the data. Please try again.",
    empty: 'No land yet. Tap Add land to start.',
    cached: 'Saved on this phone, may be out of date.',
    noProfile: 'Your profile has not been created yet.',
    noProfileHelp: 'Ask your cooperative officer to set up your account, then log in again.',
  },
  members: {
    title: 'Choose a member',
    searchLabel: 'Search member name',
    searchPlaceholder: 'Example: Ahmad',
    noMatch: 'No matching members',
    clear: 'Clear search',
    empty: 'No members yet.',
  },
  newPlot: {
    title: 'New land',
    step: 'Step 1 / 3 · Photo documents',
    docs: {
      land_title: 'Land title',
      mspo_cert: 'MSPO certificate',
      mpob_licence: 'MPOB licence',
    },
    tapToTake: 'Tap to take a photo',
    taken: 'Taken',
    ready: 'Done',
    skip: 'Skip',
    skipped: 'Skipped',
    noDocsHint: "Don't have every document? That's fine. We'll tell you what's missing.",
    next: 'Next',
    nextHelp: 'Take or skip each document',
    gallery: 'Or choose from gallery',
    thumbAlt: (doc: string) => `Photo of ${doc}`,
    map: {
      step: 'Step 2 / 3 · Your land',
      tabsLabel: 'How to record your land',
      tabs: { map: 'Draw on map', walk: 'Walk corners', point: 'One point' },
      mapLabel: 'Satellite map for drawing your land',
      hint: {
        map: 'Tap the map to place a point at each corner of your land.',
        walk: 'Walk to each corner of your land, then tap “Mark this corner”.',
        point: 'Tap the map to place one point, then enter the area. Only for land under 4 ha.',
      },
      undo: 'Undo point',
      done: 'Done',
      areaApprox: (ha: string) => `≈ ${ha} ha`,
      points: (n: number) => (n === 1 ? '1 point' : `${n} points`),
      needThree: (n: number) => `At least 3 points needed (you have ${n}).`,
      selfIntersect: 'The lines cross. Drag a point so they do not cross.',
      tooSmall: 'The area is too small. Place the points further apart.',
      myLocation: 'My location',
      useMyLocation: 'Use my location',
      markHere: 'Mark this corner',
      locating: 'Finding your location…',
      accuracy: (m: number) => `GPS accuracy ±${m} m`,
      weakGps: (m: number) =>
        `Weak GPS signal (±${m} m). Use Draw on map for a more accurate result.`,
      switchToMap: 'Use Draw on map',
      declaredLabel: 'Area (ha)',
      declaredHelp: 'Example: 2.5',
      badNumber: 'Enter the area in hectares, for example 2.5.',
      bigPoint: 'Land of 4 ha or more must have its boundary drawn on the map.',
      needArea: 'Enter the area (ha) to continue.',
      drawInstead: 'Draw on map',
      state: {
        loading: 'Loading the map…',
        'no-key': 'The map is not configured.',
        offline: 'No internet connection.',
        timeout: 'The map took too long to load.',
        script: 'The map could not be loaded.',
        auth: 'Google rejected the map key.',
        fallback: 'You can still use “Walk corners” or “One point”.',
      },
      geo: {
        denied: 'Location permission was denied. Allow location in your browser settings.',
        unsupported: 'This device does not support location.',
        timeout: 'Finding your location took too long. Try somewhere open.',
        unavailable: 'Location is not available right now.',
      },
    },
    review: {
      step: 'Step 3 / 3 · Review',
      summary: 'Summary so far',
      start: 'Start the check',
      retry: 'Try again',
      hint: 'Your documents and land boundary are sent for checking. It takes about half a minute.',
      steps: {
        plot: 'Setting up the land record…',
        area: 'Saving the land boundary…',
        docs: (done: number, total: number) => `Uploading documents (${done}/${total})…`,
        assess: 'Starting the check…',
      },
      errors: {
        network:
          'Could not reach the server. Check your internet, then try again. Your details are still here.',
        notConfigured: 'The checking service is not set up yet. Your details are still here.',
        unauthenticated: 'Your session has ended. Log in again, then try once more.',
        forbidden: 'You cannot add this land. Please contact your cooperative.',
        geometry: 'The land boundary is not valid. Go back to the map and draw it again.',
        generic:
          'Something went wrong while sending. Your details are still here; please try again.',
      },
      method: { map: 'Drawn on the map', walk: 'Walked the corners', point: 'One point' },
      area: (ha: string) => `Area: ≈ ${ha} ha`,
      declared: (ha: string) => `Declared area: ${ha} ha`,
      none: 'No land recorded yet.',
      toMap: 'Back to the map',
    },
  },
  camera: {
    frameHint: 'Place the document inside the frame',
    lightHint: 'Make sure there is enough light and no shadows.',
    opening: 'Opening camera…',
    gallery: 'Gallery',
    torchOn: 'Light on',
    torchOff: 'Light off',
    shutter: 'Take photo',
    processing: 'Processing photo…',
    use: 'Use photo',
    retake: 'Retake',
    previewAlt: 'Photo preview',
    tryAgain: 'Try again',
    chooseGallery: 'Choose from gallery',
    errors: {
      denied:
        'Camera access was not allowed. Allow the camera in your browser settings, or choose a photo from the gallery.',
      none: 'No camera found. You can choose a photo from the gallery.',
      busy: 'The camera is being used by another app. Close that app and try again.',
      insecure: 'The camera can only open on a secure connection. Choose a photo from the gallery.',
      other: "The camera couldn't be opened. Try again, or choose a photo from the gallery.",
      notImage: "That file isn't a picture. Choose a different one.",
      tooBig: 'That picture is too large. Choose a smaller one.',
      unreadable: "The picture is unclear or can't be read. Please retake it.",
    },
  },
  result: {
    title: 'Result',
    notFound: 'This land could not be found.',
    backToList: 'Back to my land',
    checkedOn: (day: string) => `Checked on ${day}`,
    banner: {
      green: { headline: 'All clear', sub: (_n: number) => 'Your documents are complete.' },
      yellow: {
        headline: 'Almost there',
        sub: (n: number) =>
          n > 0
            ? `${n} ${n === 1 ? 'thing needs' : 'things need'} doing before your documents are complete.`
            : 'A few things need checking.',
      },
      red: {
        headline: 'Action needed',
        sub: (_n: number) =>
          'There are important things to sort out. Ask your cooperative for help.',
      },
      needs_review: {
        headline: 'Officer to review',
        sub: (_n: number) => 'A cooperative officer will check your documents.',
      },
      pending: {
        headline: 'Not started',
        sub: (_n: number) => 'This land has not been checked yet.',
      },
      running: {
        headline: 'Checking now',
        sub: (_n: number) => 'The result will be ready shortly.',
      },
    },
    todo: 'To do',
    seeProgress: 'See progress',
    startCheck: 'Start the check',
    startFailed:
      'Could not start the check. Make sure the land boundary and documents were saved, then try again.',
    seeAll: (n: number) => `See all (${n})`,
    seeLess: 'Show fewer',
    passed: (n: number) => `${n} ${n === 1 ? 'check' : 'checks'} passed`,
    ruleName: (code: string) =>
      code === 'CC-01'
        ? 'Area matches the title'
        : code === 'CC-02'
          ? 'Document is still valid'
          : code === 'CC-03'
            ? 'Owner name matches'
            : 'Other check',
    forest: {
      low: 'Forest screening: no forest loss detected.',
      loss: (ha: string | null) =>
        `Forest screening: signs of forest loss after 2020${ha ? ` (${ha} ha)` : ''}. An officer will review.`,
      unknown: 'Forest screening could not be checked yet. An officer will review.',
      prelim: 'This is a preliminary screening only.',
    },
    docName: (type: string | null) =>
      type === 'land_title'
        ? 'Land title'
        : type === 'mpob_licence'
          ? 'MPOB licence'
          : type === 'mspo_cert'
            ? 'MSPO certificate'
            : type === 'mspo_member_list'
              ? 'MSPO member list'
              : 'Document',
    gapText: {
      area_mismatch: {
        title: () => "The areas don't match",
        detail: ({ facts }: GapCtx) =>
          facts.geran && facts.lukisan
            ? `Title ${facts.geran} ha, your drawing ${facts.lukisan} ha`
            : 'The area on the map differs from the title.',
        cause:
          "The drawn area may be too large, or may include someone else's land. Try drawing it again on the satellite map.",
        advice: () =>
          'Check your boundary. If you bought neighbouring land, prepare that land title too.',
        button: 'See details',
      },
      expiring: {
        title: ({ doc }: GapCtx) => `${doc} is about to expire`,
        detail: ({ facts }: GapCtx) =>
          facts.days !== null
            ? `Expires in ${facts.days} ${facts.days === 1 ? 'day' : 'days'}.`
            : 'It is about to expire.',
        cause: 'The expiry date is close. Renewing early avoids problems.',
        advice: ({ docInline }: GapCtx) =>
          `Apply to renew the ${docInline} early, then take a new photo.`,
        button: 'How to get it',
      },
      expired: {
        title: ({ doc }: GapCtx) => `${doc} has expired`,
        detail: ({ facts }: GapCtx) =>
          facts.date ? `Expired on ${facts.date}.` : 'It has expired.',
        cause: 'This document is past its expiry date.',
        advice: ({ docInline, docType }: GapCtx) =>
          `Renew the ${docInline} first${docType === 'mpob_licence' ? ' (late fees may apply)' : ''}, then take a new photo.`,
        button: 'How to get it',
      },
      name_mismatch: {
        title: ({ docInline }: GapCtx) => `The name on the ${docInline} doesn't match`,
        detail: () =>
          'The name on the document is different from the name of the person farming the land.',
        cause:
          "This often happens when the title is still in a family member's or a previous owner's name.",
        advice: () =>
          'Ask your cooperative for help. You may need inheritance papers or a letter of authority.',
        button: 'See details',
      },
      not_in_mspo: {
        title: () => 'Not on the MSPO member list',
        detail: () => "Your name wasn't found on the group certification member list.",
        cause: 'You may not be registered yet, or your name may be spelled differently.',
        advice: () => 'Ask your cooperative whether you have joined the group MSPO certification.',
        button: 'See details',
      },
      low_confidence: {
        title: ({ docInline }: GapCtx) => `The writing on the ${docInline} is unclear`,
        detail: () => 'The values in the photo need to be confirmed.',
        cause: 'The photo may be blurry, dark or have glare.',
        advice: () =>
          'Take a clearer photo, or confirm the values once the review screen is ready.',
        button: 'See details',
      },
      missing_doc: {
        title: ({ doc }: GapCtx) => `${doc} is missing`,
        detail: () => 'This document has not been submitted yet.',
        cause: "You may not have it yet, or you haven't photographed it.",
        advice: ({ docType }: GapCtx) =>
          docType === 'mpob_licence'
            ? 'Get it at the MPOB office. Bring your MyKad and your land title.'
            : docType === 'land_title'
              ? 'Get a copy of the title at your district Land and Mines Office. Bring your MyKad.'
              : docType === 'mspo_cert' || docType === 'mspo_member_list'
                ? 'Ask your cooperative or MSPO group manager.'
                : 'Ask your cooperative for help getting this document.',
        button: 'How to get it',
      },
    },
    gapUnknown: {
      title: () => 'Something needs checking',
      detail: () => 'A cooperative officer needs to check this.',
      cause: "We aren't sure what caused it.",
      advice: () => 'Ask your cooperative for help.',
      button: 'See details',
    },
  },
  issue: {
    inGeran: 'On the title',
    yourDrawing: 'Your drawing',
    causeTitle: 'Possible cause',
    adviceTitle: 'What to do',
    redraw: 'Draw again',
    redrawSoon: 'Drawing the boundary again will be available soon.',
    uploadSoon: 'Uploading a new document will be available soon.',
    notFound: 'This item was not found or is already resolved.',
    backToResult: 'Back to the result',
    polygonAlt: 'The shape of your land (preview, no map)',
  },
  coop: {
    title: 'Cooperative dashboard',
    adminRole: 'admin',
    link: 'Dashboard',
    forbidden: 'This page is for cooperative admins.',
    noCoop: 'Your account is not linked to a cooperative yet.',
    backToPlots: 'Back to my land',
    filter: 'Filter',
    allPlots: 'All plots',
    issueType: 'Issue type',
    member: 'Member',
    memberPlaceholder: 'Search name…',
    issues: {
      area: 'Area mismatch',
      expiry: 'Expired or expiring certificate',
      name: 'Name mismatch',
      missing: 'Missing document',
      mspo: 'Not on the MSPO member list',
      unclear: 'Unclear writing',
      forest: 'Forest loss (preliminary)',
    },
    forestIssue: 'Possible forest loss after 2020',
    table: {
      plot: 'Plot',
      member: 'Member',
      status: 'Status',
      mainIssue: 'Main issue',
      updated: 'Updated',
    },
    rowCount: (shown: number, total: number) => `${shown} / ${total} plots`,
    showMore: (n: number) => `Show more (${n})`,
    emptyFilter: 'No plots match the filter.',
    clearFilter: 'Clear filters',
    emptyCoop: 'There are no plots in this cooperative yet.',
    cached: 'Data from local storage, may be out of date.',
    detail: {
      choose: 'Choose a plot to see its details.',
      notInFilter: 'Not in the current filter',
      notFound: 'This plot could not be found.',
      notes: {
        pending: 'This plot has not been checked yet.',
        running: 'The assessment is still running.',
        needs_review: 'This assessment needs an officer to review it.',
      },
      issues: 'Open issues',
      noIssues: 'No open issues.',
      shape: 'Plot shape',
      shapeNote: 'Rough sketch, not a satellite map',
      openResult: 'Open full result',
      title: (lot: string, member: string) => `${lot} · ${member}`,
    },
    exportCsv: 'Export summary (CSV)',
    exportPdf: 'Export dossier (PDF)',
    csv: {
      plot: 'Plot',
      district: 'District',
      member: 'Member',
      status: 'Status',
      mainIssue: 'Main issue',
      updated: 'Updated',
    },
  },
  dossier: {
    title: 'Land compliance dossier',
    generatedOn: (date: string) => `Generated on ${date}`,
    synthetic: 'Simulated data (SAMPLE) — not real data',
    print: 'Print / Save as PDF',
    pickPlot: 'Choose a plot first',
    cached: 'This data comes from the device cache and may not be up to date.',
    printHint:
      'In the print dialog, turn off "Headers and footers" so the page address is not printed.',
    sections: {
      summary: 'Summary',
      land: 'Land details',
      location: 'Location',
      checks: 'Checks',
      open: 'Open issues',
      forest: 'Forest screening (preliminary)',
      documents: 'Documents',
      disclaimer: 'Disclaimer',
    },
    labels: {
      lot: 'Lot',
      titleNo: 'Title no.',
      mukim: 'Mukim',
      district: 'District',
      state: 'State',
      country: 'Country',
      operator: 'Operator',
      coop: 'Cooperative',
      area: 'Area',
      planted: 'Year planted',
      tenure: 'Tenure',
      landUse: 'Land use',
      boundaryDate: 'Boundary recorded on',
    },
    country: (code: string): string => (code === 'MY' ? 'Malaysia' : code),
    tenure: (value: string): string | null =>
      value === 'freehold' ? 'Freehold' : value === 'leasehold' ? 'Leasehold' : null,
    landUse: (value: string): string | null =>
      value === 'agriculture'
        ? 'Agriculture'
        : value === 'building'
          ? 'Building'
          : value === 'industry'
            ? 'Industry'
            : null,
    notChecked: 'This plot has not been checked yet.',
    location: {
      centroid: 'Centre point',
      vertices: 'Boundary points',
      no: 'No.',
      lat: 'Latitude',
      lng: 'Longitude',
      more: (n: number) => `…and ${n} more`,
      none: 'No location data.',
      shapeNote: 'Rough sketch, not a satellite map',
    },
    rules: {
      name: (code: string): string =>
        code === 'CC-01'
          ? 'Area: title vs drawing'
          : code === 'CC-02'
            ? 'Document validity'
            : code === 'CC-03'
              ? 'Owner name'
              : 'Other check',
      result: {
        pass: 'Passed',
        warn: 'Needs attention',
        fail: 'Not passed',
        needs_review: 'Needs review',
      },
      area: (geran: string, lukisan: string) => `Title ${geran} ha, drawing ${lukisan} ha`,
      validityDays: (n: number) => `${n} ${n === 1 ? 'day' : 'days'} left`,
      validityDate: (date: string) => `Expiry date: ${date}`,
      nameResult: {
        pass: 'Name matches the operator',
        warn: 'Name partly matches',
        fail: "Name doesn't match the operator",
        needs_review: 'Name needs to be confirmed',
      },
    },
    noOpen: 'No open issues.',
    forest: {
      cover: (pct: string) => `Forest cover in 2020: ${pct}%`,
      loss: (ha: string) => `Forest loss after 2020: ${ha} ha`,
    },
    docs: {
      pages: (n: number) => `${n} ${n === 1 ? 'page' : 'pages'}`,
      status: {
        extracted: 'Read',
        needs_review: 'Needs review',
        failed: 'Could not be read',
      },
      licence: (no: string | null, until: string | null): string =>
        [no ? `No. ${no}` : null, until ? `valid until ${until}` : null]
          .filter(Boolean)
          .join(' · '),
      cert: (no: string | null, until: string | null): string =>
        [no ? `No. ${no}` : null, until ? `expires ${until}` : null].filter(Boolean).join(' · '),
      none: 'No documents.',
    },
    disclaimer:
      'This dossier is generated by KebunSah as supporting material. It is not an official Due Diligence Statement (DDS) and not a compliance certification. The forest screening is preliminary only. All data was read by the system and must be reviewed by a person before it is used.',
  },
  checking: {
    title: 'Checking now',
    headline: 'Checking your land…',
    steps: {
      read: 'Reading documents',
      check: 'Checking the details',
      forest: 'Checking satellite images for forest',
      actions: 'Preparing your to-do list',
    },
    stepState: {
      done: 'Done',
      current: 'In progress',
      pending: 'Not yet',
    },
    eta: 'About 2 minutes. You can leave.',
    backToPlots: 'Back to My plots',
    doneHeadline: 'Check complete',
    doneHelp: 'The result is ready.',
    seeResult: 'See the result',
    failedHeadline: 'A cooperative officer will review this.',
    notStarted: 'This plot has not been checked yet.',
  },
};
