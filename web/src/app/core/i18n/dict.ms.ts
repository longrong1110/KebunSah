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
  months: ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'],
  status: {
    green: 'Lengkap',
    yellow: 'Perlu semakan',
    red: 'Perlu tindakan',
    // 线框里没有这个状态，临时标签；10/15 fe/polish 统一
    needs_review: 'Perlu semakan pegawai',
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
    mapSoon: 'Peta akan datang',
    mapSoonHelp: 'Langkah 2 (lukis tanah di peta) sedang disediakan.',
    thumbAlt: (doc: string) => `Gambar ${doc}`,
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
        headline: 'Perlu semakan pegawai',
        sub: (_n: number) => 'Pegawai koperasi akan menyemak dokumen anda.',
      },
      pending: { headline: 'Belum mula', sub: (_n: number) => 'Tanah ini belum diperiksa.' },
      running: {
        headline: 'Sedang disemak',
        sub: (_n: number) => 'Keputusan akan keluar sebentar lagi.',
      },
    },
    todo: 'Perlu dibuat',
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
        cause: 'Tarikh tamat sudah dekat. Memperbaharui lebih awal mengelakkan masalah dan denda.',
        advice: ({ doc }: GapCtx) =>
          `Mohon pembaharuan ${doc} lebih awal, kemudian ambil gambar yang baharu.`,
        button: 'Cara mendapatkannya',
      },
      expired: {
        title: ({ doc }: GapCtx) => `${doc} sudah tamat`,
        detail: ({ facts }: GapCtx) =>
          facts.date ? `Tamat pada ${facts.date}.` : 'Tempoh sahnya sudah tamat.',
        cause: 'Dokumen ini sudah melepasi tarikh tamat.',
        advice: ({ doc }: GapCtx) =>
          `Perbaharui ${doc} dahulu (mungkin ada fi lewat), kemudian ambil gambar yang baharu.`,
        button: 'Cara mendapatkannya',
      },
      name_mismatch: {
        title: ({ doc }: GapCtx) => `Nama pada ${doc} tidak sepadan`,
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
        title: ({ doc }: GapCtx) => `Tulisan pada ${doc} kurang jelas`,
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
};

export type Dict = typeof ms;
