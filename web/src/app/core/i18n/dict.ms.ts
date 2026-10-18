import type { GapCode, GapCtx, GapText } from './gap-text';

// 马来语词典（全量）。文案取自企划书 v3 的屏 1–4 线框与「状态与文案规范」：说人话，给下一步，不责怪用户。
// 叶子是 string 或带参数的函数（单复数、拼接都在函数里处理）。Dict 类型就是这个对象的形状：
// 英语词典声明为 Dict，缺键或多键都编译不过，所以两种语言的键永远一致。
export const ms = {
  lang: {
    code: 'BM',
    switchLabel: 'Tukar bahasa ke English',
  },
  common: {
    loading: 'Memuatkan…',
    retry: 'Cuba lagi',
    back: 'Kembali',
    close: 'Tutup',
  },
  titles: {
    login: 'Log masuk',
    plots: 'Tanah saya',
    newDocs: 'Tanah baharu · Foto dokumen',
    camera: 'Ambil gambar',
    map: 'Tanah baharu · Lukis tanah',
    review: 'Tanah baharu · Semak',
    result: 'Keputusan',
    issue: 'Butiran masalah',
    checking: 'Sedang menyemak',
    log: 'Bagaimana semakan dibuat',
    confirm: 'Semak nilai',
    coop: 'Papan pemuka koperasi',
  },
  months: ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'],
  status: {
    green: 'Lengkap',
    yellow: 'Perlu semakan',
    red: 'Perlu tindakan',
    // 线框里没有这个状态：文案取舍，与黄色的「Perlu semakan」分开（见 README）
    needs_review: 'Menunggu pegawai',
    pending: 'Belum mula',
    unknown: 'Tidak diketahui',
  },
  login: {
    title: 'Log masuk',
    lead: 'Masukkan nombor telefon anda. Tidak perlu kata laluan.',
    phoneLabel: 'Nombor telefon',
    phonePlaceholder: '+60 12-345 6789',
    hint: 'Kami hantar kod 6 digit melalui SMS.',
    send: 'Hantar kod OTP',
    sending: 'Sedang menghantar…',
    codeTitle: 'Masukkan kod',
    codeLead: (phone: string) => `Kami telah hantar kod 6 digit ke ${phone}.`,
    codeLabel: 'Kod OTP',
    confirm: 'Sahkan dan log masuk',
    confirming: 'Sedang mengesahkan…',
    resend: 'Hantar semula kod',
    resendIn: (seconds: number) => `Hantar semula dalam ${seconds}s`,
    changeNumber: 'Tukar nombor telefon',
    errors: {
      phoneEmpty: 'Sila masukkan nombor telefon anda.',
      phoneFormat: 'Nombor telefon ini tidak betul. Cuba contoh: 012-345 6789.',
      codeFormat: 'Sila masukkan kod 6 digit daripada SMS.',
      codeWrong: 'Kod tidak betul. Semak SMS anda dan cuba lagi.',
      codeExpired: 'Kod sudah tamat tempoh. Tekan Hantar semula kod.',
      tooMany: 'Terlalu banyak percubaan. Cuba lagi sebentar lagi.',
      network: 'Tiada sambungan. Semak internet anda dan cuba lagi.',
      notConfigured: 'Perkhidmatan belum disediakan.',
      generic: 'Ada masalah. Cuba lagi sebentar lagi.',
    },
  },
  plots: {
    title: 'Tanah saya',
    ownerHeader: (name: string, count: number) => `${name} · ${count} bidang tanah`,
    memberTitle: (name: string) => `Tanah ${name}`,
    add: 'Tambah tanah',
    logout: 'Log keluar',
    loggingOut: 'Sedang log keluar…',
    logoutFailed: 'Tidak dapat log keluar. Cuba lagi.',
    lot: (lot: string, district: string) => (district ? `Lot ${lot}, ${district}` : `Lot ${lot}`),
    newLot: 'Lot baharu',
    notFilled: 'Belum diisi',
    areaHa: (ha: string) => `${ha} ha`,
    loadingPlots: 'Memuatkan tanah…',
    offline: 'Tiada sambungan ke pangkalan data. Semak internet anda dan cuba lagi.',
    error: 'Tidak dapat memuat data. Cuba lagi.',
    empty: 'Belum ada tanah. Tekan Tambah tanah untuk mula.',
    cached: 'Disimpan di telefon, mungkin belum terkini.',
    noProfile: 'Profil anda belum dibuat.',
    noProfileHelp: 'Minta pegawai koperasi anda menyediakan akaun anda, kemudian log masuk semula.',
  },
  members: {
    title: 'Pilih ahli',
    searchLabel: 'Cari nama ahli',
    searchPlaceholder: 'Contoh: Ahmad',
    noMatch: 'Tiada ahli sepadan',
    clear: 'Kosongkan carian',
    empty: 'Belum ada ahli.',
  },
  newPlot: {
    title: 'Tanah baharu',
    step: 'Langkah 1 / 3 · Foto dokumen',
    docs: {
      land_title: 'Geran tanah',
      mspo_cert: 'Sijil MSPO',
      mpob_licence: 'Lesen MPOB',
    },
    tapToTake: 'Ketik untuk ambil gambar',
    taken: 'Sudah diambil',
    ready: 'Siap',
    skip: 'Langkau',
    skipped: 'Dilangkau',
    noDocsHint: 'Tidak ada semua dokumen? Tidak mengapa. Kami akan beritahu apa yang kurang.',
    next: 'Seterusnya',
    nextHelp: 'Ambil atau langkau setiap dokumen',
    gallery: 'Atau pilih dari galeri',
    thumbAlt: (doc: string) => `Gambar ${doc}`,
    map: {
      step: 'Langkah 2 / 3 · Tanah anda',
      tabsLabel: 'Cara merekod tanah',
      tabs: { map: 'Lukis di peta', walk: 'Jalan sudut', point: 'Satu titik' },
      mapLabel: 'Peta satelit untuk melukis tanah',
      hint: {
        map: 'Ketik di peta untuk letak titik pada setiap penjuru tanah.',
        walk: 'Berjalan ke setiap penjuru tanah, kemudian ketik “Tandakan sudut di sini”.',
        point:
          'Ketik di peta untuk letak satu titik, kemudian masukkan keluasan. Hanya untuk tanah kurang 4 ha.',
      },
      undo: 'Padam titik',
      done: 'Selesai',
      areaApprox: (ha: string) => `≈ ${ha} ha`,
      points: (n: number) => `${n} titik`,
      needThree: (n: number) => `Perlu sekurang-kurangnya 3 titik (sudah ${n}).`,
      selfIntersect: 'Garisan bersilang. Seret titik supaya tidak bersilang.',
      tooSmall: 'Kawasan terlalu kecil. Letak titik yang lebih berjauhan.',
      myLocation: 'Lokasi saya',
      useMyLocation: 'Guna lokasi saya',
      markHere: 'Tandakan sudut di sini',
      locating: 'Mencari lokasi…',
      accuracy: (m: number) => `Ketepatan GPS ±${m} m`,
      weakGps: (m: number) =>
        `Isyarat GPS lemah (±${m} m). Guna Lukis di peta untuk hasil lebih tepat.`,
      switchToMap: 'Guna Lukis di peta',
      declaredLabel: 'Keluasan (ha)',
      declaredHelp: 'Contoh: 2.5',
      badNumber: 'Masukkan keluasan dalam hektar, contohnya 2.5.',
      bigPoint: 'Tanah 4 ha ke atas mesti dilukis sempadannya di peta.',
      needArea: 'Masukkan keluasan (ha) untuk teruskan.',
      drawInstead: 'Lukis di peta',
      state: {
        loading: 'Memuatkan peta…',
        'no-key': 'Peta belum dikonfigurasi.',
        offline: 'Tiada sambungan internet.',
        timeout: 'Peta mengambil masa terlalu lama.',
        script: 'Peta tidak dapat dimuatkan.',
        auth: 'Kunci peta ditolak oleh Google.',
        fallback: 'Anda masih boleh guna “Jalan sudut” atau “Satu titik”.',
      },
      geo: {
        denied: 'Kebenaran lokasi ditolak. Benarkan lokasi dalam tetapan pelayar.',
        unsupported: 'Peranti ini tidak menyokong lokasi.',
        timeout: 'Lokasi mengambil masa terlalu lama. Cuba di tempat terbuka.',
        unavailable: 'Lokasi tidak tersedia sekarang.',
      },
    },
    review: {
      step: 'Langkah 3 / 3 · Semak',
      summary: 'Ringkasan setakat ini',
      start: 'Mulakan semakan',
      retry: 'Cuba lagi',
      hint: 'Dokumen dan sempadan tanah dihantar untuk disemak. Ia mengambil masa kira-kira setengah minit.',
      steps: {
        plot: 'Menyediakan rekod tanah…',
        area: 'Menyimpan sempadan tanah…',
        docs: (done: number, total: number) => `Memuat naik dokumen (${done}/${total})…`,
        assess: 'Memulakan semakan…',
      },
      errors: {
        network:
          'Tiada sambungan ke pelayan. Semak internet anda, kemudian cuba lagi. Maklumat anda masih ada di sini.',
        notConfigured: 'Perkhidmatan semakan belum disediakan. Maklumat anda masih ada di sini.',
        unauthenticated: 'Sesi anda telah tamat. Log masuk semula, kemudian cuba lagi.',
        forbidden: 'Anda tidak boleh menambah tanah ini. Hubungi koperasi anda.',
        geometry: 'Sempadan tanah tidak sah. Kembali ke peta dan lukis semula.',
        generic:
          'Sesuatu tidak kena semasa menghantar. Maklumat anda masih ada di sini; cuba lagi.',
      },
      method: { map: 'Dilukis di peta', walk: 'Berjalan di sudut tanah', point: 'Satu titik' },
      area: (ha: string) => `Keluasan: ≈ ${ha} ha`,
      declared: (ha: string) => `Keluasan dinyatakan: ${ha} ha`,
      none: 'Belum ada tanah direkodkan.',
      toMap: 'Kembali ke peta',
    },
  },
  camera: {
    frameHint: 'Letak dokumen dalam bingkai',
    lightHint: 'Pastikan cukup cahaya, tiada bayang.',
    opening: 'Membuka kamera…',
    gallery: 'Galeri',
    torchOn: 'Lampu hidup',
    torchOff: 'Lampu mati',
    shutter: 'Ambil gambar',
    processing: 'Memproses gambar…',
    use: 'Guna gambar',
    retake: 'Ambil semula',
    previewAlt: 'Pratonton gambar',
    tryAgain: 'Cuba lagi',
    chooseGallery: 'Pilih dari galeri',
    errors: {
      denied:
        'Kamera tidak dibenarkan. Benarkan kamera dalam tetapan pelayar anda, atau pilih gambar dari galeri.',
      none: 'Tiada kamera dijumpai. Anda boleh pilih gambar dari galeri.',
      busy: 'Kamera sedang digunakan oleh aplikasi lain. Tutup aplikasi itu dan cuba lagi.',
      insecure: 'Kamera hanya boleh dibuka melalui sambungan selamat. Pilih gambar dari galeri.',
      other: 'Kamera tidak dapat dibuka. Cuba lagi, atau pilih gambar dari galeri.',
      notImage: 'Fail ini bukan gambar. Pilih gambar lain.',
      tooBig: 'Gambar ini terlalu besar. Pilih gambar yang lebih kecil.',
      unreadable: 'Gambar kurang jelas atau tidak dapat dibaca. Cuba ambil semula.',
    },
  },
  result: {
    title: 'Keputusan',
    notFound: 'Tanah ini tidak dijumpai.',
    backToList: 'Kembali ke senarai tanah',
    checkedOn: (day: string) => `Disemak pada ${day}`,
    banner: {
      green: { headline: 'Semua lulus', sub: (_n: number) => 'Dokumen anda lengkap.' },
      yellow: {
        headline: 'Hampir siap',
        sub: (n: number) =>
          n > 0
            ? `${n} perkara perlu dibuat sebelum dokumen anda lengkap.`
            : 'Beberapa perkara perlu disemak.',
      },
      red: {
        headline: 'Perlu tindakan',
        sub: (_n: number) =>
          'Ada perkara penting yang perlu diselesaikan. Minta bantuan koperasi anda.',
      },
      needs_review: {
        headline: 'Menunggu semakan pegawai',
        sub: (_n: number) => 'Pegawai koperasi akan menyemak dokumen anda.',
      },
      pending: { headline: 'Belum mula', sub: (_n: number) => 'Tanah ini belum diperiksa.' },
      running: {
        headline: 'Sedang disemak',
        sub: (_n: number) => 'Keputusan akan keluar sebentar lagi.',
      },
    },
    todo: 'Perlu dibuat',
    aiNote: {
      title: 'Catatan AI',
      by: (model: string) => `Ditulis oleh ${model}, model AI. Sila semak dengan dokumen anda.`,
    },
    agentLog: 'Lihat bagaimana semakan dibuat',
    seeProgress: 'Lihat kemajuan',
    startCheck: 'Mulakan semakan',
    startFailed:
      'Tidak dapat memulakan semakan. Pastikan sempadan tanah dan dokumen telah disimpan, kemudian cuba lagi.',
    seeAll: (n: number) => `Lihat semua (${n})`,
    seeLess: 'Tunjukkan lebih sedikit',
    passed: (n: number) => `${n} semakan lulus`,
    ruleName: (code: string): string =>
      code === 'CC-01'
        ? 'Keluasan sepadan dengan geran'
        : code === 'CC-02'
          ? 'Tempoh sah dokumen'
          : code === 'CC-03'
            ? 'Nama pemilik sepadan'
            : 'Semakan lain',
    forest: {
      low: 'Saringan hutan: tiada kehilangan hutan dikesan.',
      loss: (ha: string | null) =>
        `Saringan hutan: ada tanda kehilangan hutan selepas 2020${ha ? ` (${ha} ha)` : ''}. Pegawai akan menyemak.`,
      unknown: 'Saringan hutan belum dapat disemak. Pegawai akan menyemak.',
      demo: 'Saringan hutan: data tunjuk cara sahaja. Data satelit hutan belum disambungkan.',
      prelim: 'Ini saringan awal sahaja.',
    },
    /** 文件名；不认识或没写 docType 时给通用的「Dokumen」，标题读起来才通顺 */
    docName: (type: string | null): string =>
      type === 'land_title'
        ? 'Geran tanah'
        : type === 'mpob_licence'
          ? 'Lesen MPOB'
          : type === 'mspo_cert'
            ? 'Sijil MSPO'
            : type === 'mspo_member_list'
              ? 'Senarai ahli MSPO'
              : 'Dokumen',
    // 每种缺口一组文案：说人话、给下一步、不责怪用户（企划书「状态与文案规范」）。
    // 不显示种子里的中文 description／suggestedAction，它们可能含第三人姓名；这里按 gapCode 自己写。
    gapText: {
      area_mismatch: {
        title: () => 'Keluasan tidak sepadan',
        detail: ({ facts }: GapCtx) =>
          facts.geran && facts.lukisan
            ? `Geran ${facts.geran} ha, lukisan anda ${facts.lukisan} ha`
            : 'Luas pada peta berbeza daripada geran.',
        cause:
          'Mungkin tanah yang dilukis terlalu besar, atau termasuk tanah orang lain. Cuba lukis semula di peta satelit.',
        advice: () =>
          'Semak sempadan tanah anda. Jika anda membeli tanah bersebelahan, sediakan geran tanah itu juga.',
        button: 'Lihat butiran',
      },
      expiring: {
        title: ({ doc }: GapCtx) => `${doc} hampir tamat`,
        detail: ({ facts }: GapCtx) =>
          facts.days !== null ? `Tamat dalam ${facts.days} hari.` : 'Tempoh sahnya hampir tamat.',
        cause: 'Tarikh tamat sudah dekat. Memperbaharui lebih awal mengelakkan masalah.',
        advice: ({ docInline }: GapCtx) =>
          `Mohon pembaharuan ${docInline} lebih awal, kemudian ambil gambar yang baharu.`,
        button: 'Cara mendapatkannya',
      },
      expired: {
        title: ({ doc }: GapCtx) => `${doc} sudah tamat`,
        detail: ({ facts }: GapCtx) =>
          facts.date ? `Tamat pada ${facts.date}.` : 'Tempoh sahnya sudah tamat.',
        cause: 'Dokumen ini sudah melepasi tarikh tamat.',
        advice: ({ docInline, docType }: GapCtx) =>
          `Perbaharui ${docInline} dahulu${docType === 'mpob_licence' ? ' (mungkin ada fi lewat)' : ''}, kemudian ambil gambar yang baharu.`,
        button: 'Cara mendapatkannya',
      },
      name_mismatch: {
        title: ({ docInline }: GapCtx) => `Nama pada ${docInline} tidak sepadan`,
        detail: () => 'Nama pada dokumen berbeza daripada nama pengusaha tanah.',
        cause: 'Ini biasa berlaku jika geran masih atas nama ahli keluarga atau pemilik lama.',
        advice: () =>
          'Minta bantuan koperasi anda. Anda mungkin perlu dokumen pusaka atau surat kuasa.',
        button: 'Lihat butiran',
      },
      not_in_mspo: {
        title: () => 'Tiada dalam senarai ahli MSPO',
        detail: () => 'Nama anda tidak dijumpai dalam senarai ahli pensijilan berkumpulan.',
        cause: 'Mungkin anda belum didaftarkan, atau nama dieja secara berbeza.',
        advice: () =>
          'Tanya koperasi anda sama ada anda sudah menyertai pensijilan MSPO berkumpulan.',
        button: 'Lihat butiran',
      },
      low_confidence: {
        title: ({ docInline }: GapCtx) => `Tulisan pada ${docInline} kurang jelas`,
        detail: () => 'Nilai pada gambar perlu disahkan.',
        cause: 'Gambar mungkin kabur, gelap atau ada pantulan cahaya.',
        advice: () =>
          'Ambil gambar semula yang lebih jelas, atau sahkan nilai apabila skrin semakan sedia.',
        button: 'Lihat butiran',
      },
      missing_doc: {
        title: ({ doc }: GapCtx) => `${doc} tiada`,
        detail: () => 'Dokumen ini belum diserahkan.',
        cause: 'Anda mungkin belum mendapatkannya, atau belum mengambil gambarnya.',
        advice: ({ docType }: GapCtx): string =>
          docType === 'mpob_licence'
            ? 'Dapatkan di pejabat MPOB. Bawa MyKad dan geran.'
            : docType === 'land_title'
              ? 'Dapatkan salinan geran di Pejabat Tanah dan Galian daerah anda. Bawa MyKad.'
              : docType === 'mspo_cert' || docType === 'mspo_member_list'
                ? 'Tanya koperasi atau pengurus kumpulan MSPO anda.'
                : 'Minta bantuan koperasi anda untuk mendapatkan dokumen ini.',
        button: 'Cara mendapatkannya',
      },
    } satisfies Record<GapCode, GapText>,
    /** gapCode 不认识时的兜底：不显示缺口自带的说明 */
    gapUnknown: {
      title: () => 'Perkara perlu disemak',
      detail: () => 'Perkara ini perlu disemak oleh pegawai koperasi.',
      cause: 'Kami tidak pasti puncanya.',
      advice: () => 'Minta bantuan koperasi anda.',
      button: 'Lihat butiran',
    } satisfies GapText,
  },
  issue: {
    inGeran: 'Dalam geran',
    yourDrawing: 'Lukisan anda',
    causeTitle: 'Mungkin sebabnya',
    adviceTitle: 'Cadangan',
    redraw: 'Lukis semula',
    redrawSoon: 'Peta untuk lukis semula akan tersedia tidak lama lagi.',
    uploadSoon: 'Muat naik dokumen baharu akan tersedia tidak lama lagi.',
    notFound: 'Perkara ini tidak dijumpai atau sudah selesai.',
    backToResult: 'Kembali ke keputusan',
    polygonAlt: 'Bentuk tanah anda (pratonton, tanpa peta)',
  },
  coop: {
    title: 'Papan pemuka koperasi',
    adminRole: 'pentadbir',
    link: 'Papan pemuka',
    forbidden: 'Halaman ini untuk pentadbir koperasi.',
    noCoop: 'Akaun anda belum dikaitkan dengan koperasi.',
    backToPlots: 'Kembali ke tanah saya',
    filter: 'Penapis',
    allPlots: 'Semua tanah',
    issueType: 'Jenis masalah',
    member: 'Ahli',
    memberPlaceholder: 'Cari nama…',
    issues: {
      area: 'Keluasan tidak sepadan',
      expiry: 'Dokumen tamat atau hampir tamat',
      name: 'Nama tidak sepadan',
      missing: 'Dokumen tiada',
      mspo: 'Tiada dalam senarai ahli MSPO',
      unclear: 'Tulisan kurang jelas',
      forest: 'Kehilangan hutan (saringan awal)',
    },
    forestIssue: 'Kemungkinan kehilangan hutan selepas 2020',
    table: {
      plot: 'Tanah',
      member: 'Ahli',
      status: 'Status',
      mainIssue: 'Masalah utama',
      updated: 'Dikemas kini',
    },
    rowCount: (shown: number, total: number) => `${shown} / ${total} tanah`,
    showMore: (n: number) => `Tunjuk lagi (${n})`,
    emptyFilter: 'Tiada tanah sepadan dengan penapis.',
    clearFilter: 'Kosongkan penapis',
    emptyCoop: 'Belum ada tanah dalam koperasi ini.',
    cached: 'Data daripada simpanan setempat, mungkin belum terkini.',
    detail: {
      choose: 'Pilih tanah untuk melihat butiran.',
      notInFilter: 'Tidak dalam penapis semasa',
      notFound: 'Tanah ini tidak dijumpai.',
      notes: {
        pending: 'Tanah ini belum diperiksa.',
        running: 'Penilaian sedang berjalan.',
        needs_review: 'Penilaian ini perlu disemak oleh pegawai.',
      },
      issues: 'Masalah yang belum selesai',
      noIssues: 'Tiada masalah yang belum selesai.',
      shape: 'Bentuk tanah',
      shapeNote: 'Gambaran kasar, bukan peta satelit',
      openResult: 'Buka keputusan penuh',
      title: (lot: string, member: string) => `${lot} · ${member}`,
    },
    exportCsv: 'Eksport ringkasan (CSV)',
    exportPdf: 'Eksport dokumen (PDF)',
    csv: {
      plot: 'Tanah',
      district: 'Daerah',
      member: 'Ahli',
      status: 'Status',
      mainIssue: 'Masalah utama',
      updated: 'Dikemas kini',
    },
  },
  dossier: {
    title: 'Dossier pematuhan tanah',
    generatedOn: (date: string) => `Dijana pada ${date}`,
    synthetic: 'Data simulasi (CONTOH) — bukan data sebenar',
    print: 'Cetak / Simpan sebagai PDF',
    pickPlot: 'Pilih tanah dahulu',
    cached: 'Data ini daripada simpanan peranti dan mungkin belum terkini.',
    printHint:
      'Dalam dialog cetak, matikan "Pengepala dan pengaki" supaya alamat laman tidak tercetak.',
    sections: {
      summary: 'Ringkasan',
      land: 'Maklumat tanah',
      location: 'Lokasi',
      checks: 'Semakan',
      open: 'Perkara belum selesai',
      forest: 'Saringan hutan (awal)',
      documents: 'Dokumen',
      disclaimer: 'Penafian',
    },
    labels: {
      lot: 'Lot',
      titleNo: 'No. hak milik',
      mukim: 'Mukim',
      district: 'Daerah',
      state: 'Negeri',
      country: 'Negara',
      operator: 'Pengusaha',
      coop: 'Koperasi',
      area: 'Keluasan',
      planted: 'Tahun tanam',
      tenure: 'Jenis hak milik',
      landUse: 'Kegunaan tanah',
      boundaryDate: 'Tarikh rekod sempadan',
    },
    country: (code: string): string => (code === 'MY' ? 'Malaysia' : code),
    tenure: (value: string): string | null =>
      value === 'freehold'
        ? 'Hak milik kekal (freehold)'
        : value === 'leasehold'
          ? 'Pajakan (leasehold)'
          : null,
    landUse: (value: string): string | null =>
      value === 'agriculture'
        ? 'Pertanian'
        : value === 'building'
          ? 'Bangunan'
          : value === 'industry'
            ? 'Perindustrian'
            : null,
    notChecked: 'Tanah ini belum diperiksa.',
    location: {
      centroid: 'Titik tengah',
      vertices: 'Titik sempadan',
      no: 'No.',
      lat: 'Latitud',
      lng: 'Longitud',
      more: (n: number) => `…dan ${n} lagi`,
      none: 'Tiada data lokasi.',
      shapeNote: 'Gambaran kasar, bukan peta satelit',
    },
    rules: {
      name: (code: string): string =>
        code === 'CC-01'
          ? 'Keluasan: geran lawan lukisan'
          : code === 'CC-02'
            ? 'Tempoh sah dokumen'
            : code === 'CC-03'
              ? 'Nama pemilik'
              : 'Semakan lain',
      result: {
        pass: 'Lulus',
        warn: 'Perlu perhatian',
        fail: 'Tidak lulus',
        needs_review: 'Perlu semakan',
      },
      area: (geran: string, lukisan: string) => `Geran ${geran} ha, lukisan ${lukisan} ha`,
      validityDays: (n: number) => `Baki ${n} hari`,
      validityDate: (date: string) => `Tarikh tamat: ${date}`,
      nameResult: {
        pass: 'Nama sepadan dengan pengusaha',
        warn: 'Nama sebahagian sepadan',
        fail: 'Nama tidak sepadan dengan pengusaha',
        needs_review: 'Nama perlu disahkan',
      },
    },
    noOpen: 'Tiada perkara yang belum selesai.',
    forest: {
      cover: (pct: string) => `Tutupan hutan pada 2020: ${pct}%`,
      loss: (ha: string) => `Kehilangan hutan selepas 2020: ${ha} ha`,
    },
    docs: {
      pages: (n: number) => `${n} halaman`,
      status: {
        extracted: 'Dibaca',
        needs_review: 'Perlu semakan',
        failed: 'Tidak dapat dibaca',
      },
      licence: (no: string | null, until: string | null): string =>
        [no ? `No. ${no}` : null, until ? `sah sehingga ${until}` : null]
          .filter(Boolean)
          .join(' · '),
      cert: (no: string | null, until: string | null): string =>
        [no ? `No. ${no}` : null, until ? `tamat ${until}` : null].filter(Boolean).join(' · '),
      none: 'Tiada dokumen.',
    },
    disclaimer:
      'Dokumen ini dijana oleh KebunSah sebagai bahan sokongan. Ia bukan Pernyataan Usaha Wajar (DDS) rasmi dan bukan pengesahan pematuhan. Saringan hutan hanyalah saringan awal. Semua data dibaca oleh sistem dan perlu disemak oleh manusia sebelum digunakan.',
  },
  log: {
    title: 'Bagaimana semakan dibuat',
    lead: 'Setiap langkah yang diambil sistem untuk tanah ini, seperti yang berlaku.',
    none: 'Belum ada semakan dijalankan untuk tanah ini.',
    running: 'Semakan masih berjalan. Langkah baharu muncul di sini apabila siap.',
    steps: {
      read: 'Baca dokumen',
      check: 'Semak peraturan',
      forest: 'Saring kehilangan hutan',
      actions: 'Tulis nasihat',
      pipeline: 'Keseluruhan semakan',
    },
    status: { ok: 'Siap', degraded: 'Siap dengan pilihan lain', failed: 'Gagal' },
    ms: (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`),
    facts: {
      title: 'Apa yang digunakan',
      reader: 'Dokumen dibaca oleh',
      writer: 'Nasihat ditulis oleh',
      template: 'teks terbina dalam (tanpa AI)',
      forest: 'Data hutan',
      rules: 'Versi peraturan',
      total: 'Jumlah masa',
    },
    back: 'Kembali ke keputusan',
  },
  checking: {
    title: 'Sedang menyemak',
    headline: 'Sedang menyemak tanah anda…',
    steps: {
      read: 'Membaca dokumen',
      check: 'Menyemak maklumat',
      forest: 'Menyemak imej satelit hutan',
      actions: 'Menyediakan senarai tindakan',
    },
    stepState: {
      done: 'Siap',
      current: 'Sedang dibuat',
      pending: 'Belum',
    },
    eta: 'Kira-kira 2 minit. Anda boleh keluar.',
    backToPlots: 'Kembali ke Tanah saya',
    doneHeadline: 'Semakan siap',
    doneHelp: 'Keputusan sudah ada.',
    seeResult: 'Lihat keputusan',
    failedHeadline: 'Pegawai koperasi akan menyemak.',
    notStarted: 'Tanah ini belum diperiksa.',
  },
};

export type Dict = typeof ms;
