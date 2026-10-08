-- KebunSah 数据库 schema（PostgreSQL 16）
-- 由企划书第 8 章的表定义自动生成，两边永远一致。
--
-- 每一列的 COMMENT 以 [证]/[册]/[规]/[约]/[系]/[待] 开头，表示这一列的现实依据：
--   证 纸面原文   册 官方系统   规 法规/要求   约 团队约定   系 系统需要   待 待核实
-- 查看：  \d+ land_titles     或   SELECT col_description('land_titles'::regclass, 4);
--
-- 重要：本文件末尾的 3 个地块、人名、身份证号、执照号、证书号全部是虚构的演示数据（is_synthetic = true）。
-- 身份证号只存 SHA-256 哈希。上线前请给哈希加一个服务端秘密值（pepper），不要用裸 SHA-256。
--
-- 使用：  createdb kebunsah && psql kebunsah -v ON_ERROR_STOP=1 -f schema.sql
-- Firestore 版本的对应关系见企划书 8.9 节。

BEGIN;

-- 自然人（第 1 批）：MyKad 上的人。它和「用户账号」「地契登记持有人」是三个不同的东西：同一个人可以同时是三者，也可能只是其中之一（例如地契上已故的父亲、没有手机账号的老园主）。
CREATE TABLE persons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  ic_hash text UNIQUE,
  ic_last4 char(4) CHECK (ic_last4 ~ '^[0-9]{4}$'),
  is_synthetic boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 合作社 / 小园主组织（第 1 批）：管理一批小园主的组织。MPOB 申请要求合作社、公司等团体附注册证明，所以名称与注册资料按注册证明存。
CREATE TABLE cooperatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  registration_body text CHECK (registration_body IN ('SKM','SSM','other')),
  registration_no text,
  state text NOT NULL,
  is_synthetic boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 应用账号（第 1 批）：能登录 App 或后台的账号，不等于园主本人。外勤人员、合作社管理员也是账号。
CREATE TABLE users (
  id text PRIMARY KEY,
  phone text NOT NULL UNIQUE CHECK (phone ~ '^\+[0-9]{8,15}$'),
  role text NOT NULL CHECK (role IN ('smallholder','field_officer','coop_admin')),
  language text NOT NULL DEFAULT 'ms' CHECK (language IN ('ms','en','zh')),
  person_id uuid REFERENCES persons(id),
  coop_id uuid REFERENCES cooperatives(id),
  last_login_at timestamptz,
  is_synthetic boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 地契 / Hakmilik（第 1 批）：一张地契对应一个地段（lot）。栏位照《国家土地法典》的地契表格（以 Form 5E 租约为样本）和 MSPO 公开报告里的地契写法来建。
CREATE TABLE land_titles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_type text NOT NULL CHECK (title_type IN ('GRN','GM','HSD','HSM','PN','PM','OTHER')),
  title_no text NOT NULL,
  lot_no text NOT NULL,
  mukim text,
  district text NOT NULL,
  state text NOT NULL,
  locality text,
  area_value numeric(12,4) NOT NULL CHECK (area_value > 0),
  area_unit text NOT NULL CHECK (area_unit IN ('ha','sqm','acre','sqft')),
  area_ha numeric(12,4) GENERATED ALWAYS AS (round(CASE area_unit WHEN 'ha' THEN area_value WHEN 'sqm' THEN area_value/10000 WHEN 'acre' THEN area_value*0.40468564224 WHEN 'sqft' THEN area_value*0.09290304/10000 END, 4)) STORED,
  land_use_category text CHECK (land_use_category IN ('agriculture','building','industry','nil')),
  tenure text CHECK (tenure IN ('freehold','leasehold')),
  lease_expiry date,
  date_first_alienation date,
  express_conditions text,
  restrictions_in_interest text,
  annual_rent_rm numeric(10,2),
  special_area_type text NOT NULL DEFAULT 'none' CHECK (special_area_type IN ('none','malay_reservation','aboriginal_area','aboriginal_reserve','group_settlement_area','other')),
  special_area_gazette text,
  standard_sheet_no text,
  certified_plan_no text,
  source_document_id uuid,
  verification_level text NOT NULL DEFAULT 'extracted' CHECK (verification_level IN ('extracted','confirmed','official')),
  is_synthetic boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT land_titles_tenure_ck CHECK (tenure IS DISTINCT FROM 'freehold' OR lease_expiry IS NULL)
);

CREATE INDEX land_titles_loc_ix ON land_titles (state, district, lot_no);

-- 地契登记持有人（第 1 批）：地契背面「Record of Proprietorship」里列出的持有人，可能有多位（共有人）。名字按纸面存，不强行合并成一个人。这正是现实里常见的坑：地契还在已故父亲名下（tanah pusaka），现在种地的是儿子。
CREATE TABLE title_proprietors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  land_title_id uuid NOT NULL REFERENCES land_titles(id) ON DELETE CASCADE,
  seq smallint NOT NULL DEFAULT 1,
  name_as_printed text NOT NULL,
  ic_hash text,
  ic_last4 char(4),
  share_text text,
  person_id uuid REFERENCES persons(id),
  is_synthetic boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (land_title_id, seq)
);

CREATE INDEX title_proprietors_ic_ix ON title_proprietors (ic_hash);

-- 地契权益记录（第 2 批）：地契末页「Record of Dealings and of Other Matters Affecting Title」：抵押、租赁、过户、备忘等。第二批再建，因为本轮规则还没用到。
CREATE TABLE title_endorsements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  land_title_id uuid NOT NULL REFERENCES land_titles(id) ON DELETE CASCADE,
  kind text NOT NULL,
  entry_date date,
  details text,
  is_synthetic boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- MPOB 小园主执照（第 1 批）：Lesen Pekebun Kecil (SH)：MPOB 发给小园主、用于买卖和运送 FFB 的执照。官方有 E-LesenPK 查询（按身份证号或执照号）。
CREATE TABLE mpob_licences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  licence_no text NOT NULL UNIQUE,
  licence_type text NOT NULL DEFAULT 'SH' CHECK (licence_type IN ('SH')),
  holder_name text NOT NULL,
  holder_ic_hash text,
  holder_ic_last4 char(4),
  holder_person_id uuid REFERENCES persons(id),
  valid_until date NOT NULL,
  lot_text text,
  source_document_id uuid,
  verification_level text NOT NULL DEFAULT 'extracted' CHECK (verification_level IN ('extracted','confirmed','official')),
  is_synthetic boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mpob_licences_exp_ix ON mpob_licences (valid_until);

CREATE INDEX mpob_licences_ic_ix ON mpob_licences (holder_ic_hash);

-- MSPO 证书（第 1 批）：马来西亚可持续棕油证书。小园主多半是「团体计划」的成员：证书面上只写团体和管理公司，个人要靠成员名单（下一张表）证明在认证范围内。栏位照 BSI 公开的 MSPO 报告（WAGS 西霹雳小园主团体）来建。
CREATE TABLE mspo_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cert_no text NOT NULL UNIQUE,
  certificate_holder text NOT NULL,
  certification_unit text NOT NULL,
  standard text NOT NULL,
  scope text CHECK (scope IN ('estate','mill')),
  start_date date NOT NULL,
  first_certified_date date,
  expiry_date date NOT NULL,
  members_count integer CHECK (members_count >= 0),
  planted_ha numeric(12,2),
  hcv_ha numeric(12,2),
  infrastructure_other_ha numeric(12,2),
  total_area_ha numeric(12,2),
  cert_body text,
  emspo_track_id text,
  spoc_no text,
  source_document_id uuid,
  verification_level text NOT NULL DEFAULT 'extracted' CHECK (verification_level IN ('extracted','confirmed','official')),
  is_synthetic boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mspo_cert_dates_ck CHECK (expiry_date > start_date),
  CONSTRAINT mspo_cert_first_ck CHECK (first_certified_date IS NULL OR first_certified_date <= start_date)
);

CREATE INDEX mspo_certificates_exp_ix ON mspo_certificates (expiry_date);

-- MSPO 证书成员名单（第 1 批）：团体证书的附录：逐个列出成员、地块号、地契和 MPOB 执照号。现实里「这个园主在不在认证范围」靠这张名单，不靠证书面。队友文档的待商榷项「团体证书只写团体名」正对应这里。
CREATE TABLE mspo_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_id uuid NOT NULL REFERENCES mspo_certificates(id) ON DELETE CASCADE,
  member_no integer NOT NULL,
  member_name text NOT NULL,
  plot_no text,
  land_title_text text,
  mpob_licence_no text,
  person_id uuid REFERENCES persons(id),
  land_title_id uuid REFERENCES land_titles(id),
  is_synthetic boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (certificate_id, member_no)
);

CREATE INDEX mspo_members_lic_ix ON mspo_members (mpob_licence_no);

-- 地块（EUDR plot of land）（第 1 批）：EUDR 意义上的「地块」：一块连续的土地。流程是先拍文件、再圈地块，所以建档时位置是空的，圈完才补。种地的人、地契持有人、执照持有人可能是不同的人，各自用外键指过去。
CREATE TABLE plots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname text,
  operator_person_id uuid NOT NULL REFERENCES persons(id),
  coop_id uuid REFERENCES cooperatives(id),
  land_title_id uuid REFERENCES land_titles(id),
  mpob_licence_id uuid REFERENCES mpob_licences(id),
  mspo_member_id uuid REFERENCES mspo_members(id),
  country_code char(2) NOT NULL DEFAULT 'MY',
  geometry_type text CHECK (geometry_type IN ('point','polygon')),
  centroid_lat numeric(9,6) CHECK (centroid_lat BETWEEN -90 AND 90),
  centroid_lng numeric(9,6) CHECK (centroid_lng BETWEEN -180 AND 180),
  polygon_geojson jsonb CHECK (jsonb_typeof(polygon_geojson) = 'object'),
  area_ha_computed numeric(10,4) CHECK (area_ha_computed > 0),
  area_ha_declared numeric(10,4) CHECK (area_ha_declared > 0),
  oil_palm_planted_year smallint CHECK (oil_palm_planted_year BETWEEN 1950 AND 2100),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','green','yellow','red','needs_review')),
  geometry_recorded_at timestamptz,
  last_assessed_at timestamptz,
  is_synthetic boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plots_geometry_ck CHECK (
    geometry_type IS NULL
    OR (geometry_type = 'polygon' AND polygon_geojson IS NOT NULL AND area_ha_computed IS NOT NULL)
    OR (geometry_type = 'point' AND centroid_lat IS NOT NULL AND centroid_lng IS NOT NULL
        AND area_ha_declared IS NOT NULL AND area_ha_declared < 4)
  )
);

CREATE INDEX plots_coop_status_ix ON plots (coop_id, status);

CREATE INDEX plots_operator_ix ON plots (operator_person_id);

-- 用户上传的文件（照片）（第 1 批）：园主拍下来的原件照片。地契要拍好几页（正面和背面的持有人记录），所以一张证件可有多条记录。
CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plot_id uuid NOT NULL REFERENCES plots(id) ON DELETE CASCADE,
  doc_type text NOT NULL CHECK (doc_type IN ('land_title','mpob_licence','mspo_cert','mspo_member_list')),
  page_no smallint NOT NULL DEFAULT 1,
  is_current boolean NOT NULL DEFAULT true,
  storage_path text NOT NULL,
  mime_type text,
  sha256 char(64),
  source text NOT NULL DEFAULT 'camera' CHECK (source IN ('camera','gallery','seed')),
  uploaded_by text REFERENCES users(id),
  captured_at timestamptz,
  extraction_status text NOT NULL DEFAULT 'uploaded' CHECK (extraction_status IN ('uploaded','extracting','extracted','failed','needs_review')),
  extracted_at timestamptz,
  model_version text,
  is_synthetic boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX documents_current_ux ON documents (plot_id, doc_type, page_no) WHERE is_current;

CREATE INDEX documents_plot_ix ON documents (plot_id);

-- 文件里读出的字段（第 1 批）：Gemini 从每张照片读出的逐项字段，附置信度。线框图屏 8「确认字段」就是读这张表、写 confirmed_*。身份证号读出后先打码再入库。
CREATE TABLE document_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  raw_text text,
  normalized_value text,
  confidence numeric(3,2) CHECK (confidence BETWEEN 0 AND 1),
  confirmed_value text,
  confirmed_by text REFERENCES users(id),
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, field_key)
);

-- 评估（第 1 批）：每次点「开始评估」生成一条，保留历史供审计。森林初筛的结果也放在这里。
CREATE TABLE assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plot_id uuid NOT NULL REFERENCES plots(id) ON DELETE CASCADE,
  run_status text NOT NULL DEFAULT 'queued' CHECK (run_status IN ('queued','running','done','failed')),
  result text CHECK (result IN ('green','yellow','red','needs_review')),
  started_at timestamptz,
  finished_at timestamptz,
  model_version text NOT NULL,
  rules_version text,
  input_snapshot jsonb,
  forest_dataset text,
  forest_cover_2020_pct numeric(5,2) CHECK (forest_cover_2020_pct BETWEEN 0 AND 100),
  forest_loss_after_2020_ha numeric(10,4) CHECK (forest_loss_after_2020_ha >= 0),
  forest_risk text CHECK (forest_risk IN ('low','medium','high','unknown')),
  summary_text text,
  summary_lang text CHECK (summary_lang IN ('ms','en','zh')),
  error_message text,
  is_synthetic boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assessments_done_ck CHECK (run_status <> 'done' OR result IS NOT NULL)
);

CREATE INDEX assessments_plot_ix ON assessments (plot_id, created_at DESC);

-- 规则逐条结果（第 1 批）：每条规则一行：期望值、实际值、用了什么阈值、结果。看板的「查原因」读这张表。
CREATE TABLE rule_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  rule_code text NOT NULL CHECK (rule_code ~ '^CC-[0-9]{2}$'),
  result text NOT NULL CHECK (result IN ('pass','warn','fail','needs_review')),
  expected_value text,
  actual_value text,
  params_used jsonb,
  evidence jsonb,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assessment_id, rule_code)
);

-- 缺口清单（第 1 批）：还差什么才能变绿：缺哪份文件、哪里不一致、建议怎么补。
CREATE TABLE gaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  gap_code text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('high','medium','low')),
  doc_type text CHECK (doc_type IN ('land_title','mpob_licence','mspo_cert','mspo_member_list')),
  description text NOT NULL,
  suggested_action text,
  citation text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX gaps_assessment_ix ON gaps (assessment_id);

-- 规则阈值（第 1 批）：所有阈值放表里，不写死在代码里。每一行都标明是法规给的，还是我们团队定的。前者别改，后者可以按数据调。
CREATE TABLE rule_params (
  rule_code text NOT NULL,
  param_key text NOT NULL,
  value numeric NOT NULL,
  unit text,
  basis text NOT NULL CHECK (basis IN ('law','mpob','team')),
  note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rule_code, param_key)
);

-- 操作审计（第 2 批）：谁在什么时候改了什么。合规类产品需要，第二批再建；本轮 Cloud Logging 先顶着。
CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor_user_id text REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  detail jsonb
);

-- 循环外键：documents 建好后再补
ALTER TABLE land_titles ADD CONSTRAINT land_titles_source_document_fk FOREIGN KEY (source_document_id) REFERENCES documents(id);
ALTER TABLE mpob_licences ADD CONSTRAINT mpob_licences_source_document_fk FOREIGN KEY (source_document_id) REFERENCES documents(id);
ALTER TABLE mspo_certificates ADD CONSTRAINT mspo_certificates_source_document_fk FOREIGN KEY (source_document_id) REFERENCES documents(id);

-- 每一列的现实依据，写进数据库自己的注释里
COMMENT ON COLUMN persons.id IS '[系] 主键';
COMMENT ON COLUMN persons.full_name IS '[证] MyKad 姓名栏。地契、执照、证书上也印姓名，按纸面原样存：保留大写、BIN / BINTI、A/L、A/P，不改写不展开';
COMMENT ON COLUMN persons.ic_hash IS '[证] MyKad 12 位号码（YYMMDD-PB-###G：出生日期 + 出生地代码 + 序号）。只存 SHA-256 哈希，用来判断「是不是同一个人」；完整号码不入库';
COMMENT ON COLUMN persons.ic_last4 IS '[系] 只用于界面显示（******-**-1234）';
COMMENT ON COLUMN persons.is_synthetic IS '[系] 是否模拟数据。演示用的 200 个地块全部为 true，避免被误当成真实记录';
COMMENT ON COLUMN persons.created_at IS '[系] 建立时间';
COMMENT ON TABLE persons IS '自然人';
COMMENT ON COLUMN cooperatives.id IS '[系] 主键';
COMMENT ON COLUMN cooperatives.name IS '[规] MPOB 准则：个人附身份证，合伙、有限公司、合作社附注册文件；名称以注册证明为准';
COMMENT ON COLUMN cooperatives.registration_body IS '[待] 合作社归 Suruhanjaya Koperasi Malaysia（SKM）、公司归 SSM，这是常识，未在本次来源核对';
COMMENT ON COLUMN cooperatives.registration_no IS '[待] 注册号格式待核实，先当文本存';
COMMENT ON COLUMN cooperatives.state IS '[约] v2 约定：state 决定适用哪个州的土地流程';
COMMENT ON COLUMN cooperatives.is_synthetic IS '[系] 是否模拟数据。演示用的 200 个地块全部为 true，避免被误当成真实记录';
COMMENT ON COLUMN cooperatives.created_at IS '[系] 建立时间';
COMMENT ON TABLE cooperatives IS '合作社 / 小园主组织';
COMMENT ON COLUMN users.id IS '[系] Firebase Auth 的 uid';
COMMENT ON COLUMN users.phone IS '[系] 手机号 + 验证码登录，国际格式（马来西亚手机号以 +60 开头）';
COMMENT ON COLUMN users.role IS '[约] v2 的三种角色：小园主、外勤人员、合作社管理员';
COMMENT ON COLUMN users.language IS '[约] 线框图约定马来语优先；本轮先做 ms / en';
COMMENT ON COLUMN users.person_id IS '[系] 这个账号对应哪个自然人（外勤、管理员可为空）';
COMMENT ON COLUMN users.coop_id IS '[系] 所属合作社';
COMMENT ON COLUMN users.last_login_at IS '[系] 最后登录时间';
COMMENT ON COLUMN users.is_synthetic IS '[系] 是否模拟数据。演示用的 200 个地块全部为 true，避免被误当成真实记录';
COMMENT ON COLUMN users.created_at IS '[系] 建立时间';
COMMENT ON TABLE users IS '应用账号';
COMMENT ON COLUMN land_titles.id IS '[系] 主键';
COMMENT ON COLUMN land_titles.title_type IS '[待] 地契类别缩写：HSM（Hakmilik Sementara Mukim）、PM（Pajakan Mukim）在本次来源里见过；GRN、GM、HSD、PN 是马来西亚惯用写法，未逐一核对';
COMMENT ON COLUMN land_titles.title_no IS '[证] 登记簿编号。MSPO 公开报告的地契栏写成 No. HSM145/78；Form 5E 登记簿抬头写 No. ML…';
COMMENT ON COLUMN land_titles.lot_no IS '[证] Form 5E「Lot No」；MSPO 报告写作 Lot 7030';
COMMENT ON COLUMN land_titles.mukim IS '[证] Form 5E「Mukim」';
COMMENT ON COLUMN land_titles.district IS '[证] Form 5E「District」（Daerah）';
COMMENT ON COLUMN land_titles.state IS '[证] Form 5E 抬头「State of …」';
COMMENT ON COLUMN land_titles.locality IS '[证] Form 5E「Locality」';
COMMENT ON COLUMN land_titles.area_value IS '[证] Form 5E「Area of lot」，按纸面原数字存';
COMMENT ON COLUMN land_titles.area_unit IS '[待] 纸面单位可能是公顷、平方米、英亩、平方英尺；更老的 ruai / depa 等写法待核实';
COMMENT ON COLUMN land_titles.area_ha IS '[系] 按单位自动换算成公顷（生成列）。规则只比这一列，不比纸面数字';
COMMENT ON COLUMN land_titles.land_use_category IS '[证] Form 5E「Category of land use」：Agriculture / Building / Industry / NIL（马来语 Pertanian / Bangunan / Perusahaan）';
COMMENT ON COLUMN land_titles.tenure IS '[证] MSPO 报告写 Perpetuity ownership（永久业权）；Form 5E 本身是 Mukim Lease（租约）';
COMMENT ON COLUMN land_titles.lease_expiry IS '[待] 队友文档列了「租约到期日」；Form 5E 表头没有这一栏，租期应写在正文里，待核实';
COMMENT ON COLUMN land_titles.date_first_alienation IS '[证] Form 5E「Date of first alienation」（首次批出日期）';
COMMENT ON COLUMN land_titles.express_conditions IS '[证] Form 5E「Express conditions」（Syarat Nyata）：土地用途等条件';
COMMENT ON COLUMN land_titles.restrictions_in_interest IS '[证] Form 5E「Restrictions in interest」（Sekatan Kepentingan）：转让等限制';
COMMENT ON COLUMN land_titles.annual_rent_rm IS '[证] Form 5E「Annual rent RM」（年租）';
COMMENT ON COLUMN land_titles.special_area_type IS '[证] Form 5E「Within Malay Reservation / Aboriginal Area / Aboriginal Reserve / Group Settlement Area」';
COMMENT ON COLUMN land_titles.special_area_gazette IS '[证] Form 5E 同一行的「Gazette Notification No / dated」，连号码与日期一起存成文本';
COMMENT ON COLUMN land_titles.standard_sheet_no IS '[证] Form 5E「Standard Sheet No」';
COMMENT ON COLUMN land_titles.certified_plan_no IS '[证] Form 5E「Certified Plan No」（测量图编号），以后可对接官方测量图';
COMMENT ON COLUMN land_titles.source_document_id IS '[系] 这条记录是从哪张照片读出来的（外键在建完 documents 后补上）';
COMMENT ON COLUMN land_titles.verification_level IS '[约] 来源可信度：extracted＝只经 AI 读出；confirmed＝用户在屏 8 确认过；official＝对照官方网站核实过（本轮不做，留位）';
COMMENT ON COLUMN land_titles.is_synthetic IS '[系] 是否模拟数据。演示用的 200 个地块全部为 true，避免被误当成真实记录';
COMMENT ON COLUMN land_titles.created_at IS '[系] 建立时间';
COMMENT ON COLUMN land_titles.updated_at IS '[系] 最后修改时间';
COMMENT ON TABLE land_titles IS '地契 / Hakmilik';
COMMENT ON COLUMN title_proprietors.id IS '[系] 主键';
COMMENT ON COLUMN title_proprietors.land_title_id IS '[系] 属于哪张地契';
COMMENT ON COLUMN title_proprietors.seq IS '[系] 在地契上的排列顺序';
COMMENT ON COLUMN title_proprietors.name_as_printed IS '[证] Form 5E 末页标题「Record of Proprietorship, of Dealings and of Other Matters Affecting Title」；队友文档：地契有持有人姓名';
COMMENT ON COLUMN title_proprietors.ic_hash IS '[证] 队友文档：地契有持有人身份证号。同样只存哈希';
COMMENT ON COLUMN title_proprietors.ic_last4 IS '[系] 界面显示用';
COMMENT ON COLUMN title_proprietors.share_text IS '[待] MPOB 准则提到「涉及份额时要附授权书或 POA」，说明现实里有共有份额；纸面写法（如 1/2）待核实';
COMMENT ON COLUMN title_proprietors.person_id IS '[系] 对上 persons 之后回填';
COMMENT ON COLUMN title_proprietors.is_synthetic IS '[系] 是否模拟数据。演示用的 200 个地块全部为 true，避免被误当成真实记录';
COMMENT ON COLUMN title_proprietors.created_at IS '[系] 建立时间';
COMMENT ON TABLE title_proprietors IS '地契登记持有人';
COMMENT ON COLUMN title_endorsements.id IS '[系] 主键';
COMMENT ON COLUMN title_endorsements.land_title_id IS '[系] 属于哪张地契';
COMMENT ON COLUMN title_endorsements.kind IS '[待] 记录类别（如抵押 gadaian、备忘 kaveat）；各类别的标准名称待核实，先用文本';
COMMENT ON COLUMN title_endorsements.entry_date IS '[待] 记录日期';
COMMENT ON COLUMN title_endorsements.details IS '[待] 纸面原文';
COMMENT ON COLUMN title_endorsements.is_synthetic IS '[系] 是否模拟数据。演示用的 200 个地块全部为 true，避免被误当成真实记录';
COMMENT ON COLUMN title_endorsements.created_at IS '[系] 建立时间';
COMMENT ON TABLE title_endorsements IS '地契权益记录';
COMMENT ON COLUMN mpob_licences.id IS '[系] 主键';
COMMENT ON COLUMN mpob_licences.licence_no IS '[册] E-LesenPK 可按「No. Lesen」查询；MSPO 报告里见到的样例是 12 位数字（是否全部如此待核实）';
COMMENT ON COLUMN mpob_licences.licence_type IS '[规] MPOB 准则：Lesen Pekebun Kecil (SH)，针对 100 英亩（40.46 公顷）以下的小园主';
COMMENT ON COLUMN mpob_licences.holder_name IS '[册] E-LesenPK 输出分「Butiran Lesen」（执照资料）和「Butiran Pemohon」（申请人资料）；栏位原名待核实';
COMMENT ON COLUMN mpob_licences.holder_ic_hash IS '[册] E-LesenPK 可按 Nombor Pengenalan 查询，说明执照与身份证号绑定。同样只存哈希';
COMMENT ON COLUMN mpob_licences.holder_ic_last4 IS '[系] 界面显示用';
COMMENT ON COLUMN mpob_licences.holder_person_id IS '[系] 对上 persons 之后回填';
COMMENT ON COLUMN mpob_licences.valid_until IS '[证] MSPO 公开报告附录对每位成员列出执照 valid until 日期；MPOB 常见问题提到逾期要付 fi lewat / fi tamat tempoh';
COMMENT ON COLUMN mpob_licences.lot_text IS '[待] 队友文档说执照载明地段号；MPOB 准则未写执照印哪些栏位，待核实';
COMMENT ON COLUMN mpob_licences.source_document_id IS '[系] 这条记录是从哪张照片读出来的（外键在建完 documents 后补上）';
COMMENT ON COLUMN mpob_licences.verification_level IS '[约] 来源可信度：extracted＝只经 AI 读出；confirmed＝用户在屏 8 确认过；official＝对照官方网站核实过（本轮不做，留位）';
COMMENT ON COLUMN mpob_licences.is_synthetic IS '[系] 是否模拟数据。演示用的 200 个地块全部为 true，避免被误当成真实记录';
COMMENT ON COLUMN mpob_licences.created_at IS '[系] 建立时间';
COMMENT ON COLUMN mpob_licences.updated_at IS '[系] 最后修改时间';
COMMENT ON TABLE mpob_licences IS 'MPOB 小园主执照';
COMMENT ON COLUMN mspo_certificates.id IS '[系] 主键';
COMMENT ON COLUMN mspo_certificates.cert_no IS '[证] MSPO 报告「Certificate Number」，样例写作 MSPO 加 6 位数字（仅见一例）';
COMMENT ON COLUMN mspo_certificates.certificate_holder IS '[证] 报告「Company Name」：证书持有人，团体计划里是管理公司，不是小园主';
COMMENT ON COLUMN mspo_certificates.certification_unit IS '[证] 报告「Name of the Certification Unit (Independent Smallholder)」，样例带成员数，如「… Smallholders (279 members)」';
COMMENT ON COLUMN mspo_certificates.standard IS '[证] 报告「Standard」：MS 2530-2:2013 General Principles for Independent Smallholders';
COMMENT ON COLUMN mspo_certificates.scope IS '[证] 报告「Scope of Certification」：Estate / Mill 勾选。小园主证书为 Estate（Production of Sustainable Oil Palm Fruits）';
COMMENT ON COLUMN mspo_certificates.start_date IS '[证] 报告「Certificate Start Date」';
COMMENT ON COLUMN mspo_certificates.first_certified_date IS '[证] 报告「Date of First Certification」';
COMMENT ON COLUMN mspo_certificates.expiry_date IS '[证] 报告「Certificate Expiry Date」。样例：2023-10-04 起、2028-10-03 止，周期 5 年';
COMMENT ON COLUMN mspo_certificates.members_count IS '[证] 报告第 1.4、2 节「279 members」';
COMMENT ON COLUMN mspo_certificates.planted_ha IS '[证] 报告 1.5「Total Planted (Mature + Immature) (ha)」';
COMMENT ON COLUMN mspo_certificates.hcv_ha IS '[证] 报告 1.5「HCV (ha)」（高保护价值区面积）';
COMMENT ON COLUMN mspo_certificates.infrastructure_other_ha IS '[证] 报告 1.5「Infrastructure & Other (ha)」';
COMMENT ON COLUMN mspo_certificates.total_area_ha IS '[证] 报告 1.5「Total Area (ha)」';
COMMENT ON COLUMN mspo_certificates.cert_body IS '[待] 发证机构（如 BSI）。公开报告由 BSI 托管，但证书上的栏位名未核实';
COMMENT ON COLUMN mspo_certificates.emspo_track_id IS '[待] 队友文档：eMSPO 公开页有 Track ID。我这边被 robots 挡住，没能核实';
COMMENT ON COLUMN mspo_certificates.spoc_no IS '[待] 队友文档：eMSPO 公开页有 SPOC 编号。未核实';
COMMENT ON COLUMN mspo_certificates.source_document_id IS '[系] 这条记录是从哪张照片读出来的（外键在建完 documents 后补上）';
COMMENT ON COLUMN mspo_certificates.verification_level IS '[约] 来源可信度：extracted＝只经 AI 读出；confirmed＝用户在屏 8 确认过；official＝对照官方网站核实过（本轮不做，留位）';
COMMENT ON COLUMN mspo_certificates.is_synthetic IS '[系] 是否模拟数据。演示用的 200 个地块全部为 true，避免被误当成真实记录';
COMMENT ON COLUMN mspo_certificates.created_at IS '[系] 建立时间';
COMMENT ON COLUMN mspo_certificates.updated_at IS '[系] 最后修改时间';
COMMENT ON TABLE mspo_certificates IS 'MSPO 证书';
COMMENT ON COLUMN mspo_members.id IS '[系] 主键';
COMMENT ON COLUMN mspo_members.certificate_id IS '[系] 属于哪张证书';
COMMENT ON COLUMN mspo_members.member_no IS '[证] 报告附录 A 表头「No.」';
COMMENT ON COLUMN mspo_members.member_name IS '[证] 报告附录 A「Smallholders」';
COMMENT ON COLUMN mspo_members.plot_no IS '[证] 报告附录 A「Plot No.」';
COMMENT ON COLUMN mspo_members.land_title_text IS '[证] 报告附录 A「Land Title」：一个格子里写地段号、地契号、面积、地点、用途、业权类型。原文整格保存，另用外键指向解析后的地契';
COMMENT ON COLUMN mspo_members.mpob_licence_no IS '[证] 报告附录 A「MPOB License」';
COMMENT ON COLUMN mspo_members.person_id IS '[系] 对上 persons 之后回填';
COMMENT ON COLUMN mspo_members.land_title_id IS '[系] 对上地契之后回填';
COMMENT ON COLUMN mspo_members.is_synthetic IS '[系] 是否模拟数据。演示用的 200 个地块全部为 true，避免被误当成真实记录';
COMMENT ON COLUMN mspo_members.created_at IS '[系] 建立时间';
COMMENT ON TABLE mspo_members IS 'MSPO 证书成员名单';
COMMENT ON COLUMN plots.id IS '[系] 主键';
COMMENT ON COLUMN plots.nickname IS '[系] 园主自己给地块起的名字（线框图屏 2）';
COMMENT ON COLUMN plots.operator_person_id IS '[系] 实际种这块地、用 App 的人';
COMMENT ON COLUMN plots.coop_id IS '[系] 归哪个合作社管理';
COMMENT ON COLUMN plots.land_title_id IS '[系] 对应的地契；文件读出并确认前为空';
COMMENT ON COLUMN plots.mpob_licence_id IS '[系] 对应的 MPOB 执照';
COMMENT ON COLUMN plots.mspo_member_id IS '[系] 证明在 MSPO 认证范围内的那一行成员名单';
COMMENT ON COLUMN plots.country_code IS '[规] EUDR 声明（Annex II）要写生产国';
COMMENT ON COLUMN plots.geometry_type IS '[规] EUDR：4 公顷以下可以只给一个点，更大的要给多边形。圈地块前为空';
COMMENT ON COLUMN plots.centroid_lat IS '[规] EUDR 坐标至少 6 位小数；numeric(9,6) 正好保留 6 位';
COMMENT ON COLUMN plots.centroid_lng IS '[规] 同上';
COMMENT ON COLUMN plots.polygon_geojson IS '[规] 多边形边界，GeoJSON Polygon，坐标顺序 [经度, 纬度]。坐标系先按 WGS84（GPS 与 Google 地图默认）；EUDR 对坐标系的明文要求待核实';
COMMENT ON COLUMN plots.area_ha_computed IS '[系] 后端用多边形重新计算的面积，不信前端传的数';
COMMENT ON COLUMN plots.area_ha_declared IS '[约] 只记一个点时园主手填的面积（第 11 章降级方案）';
COMMENT ON COLUMN plots.oil_palm_planted_year IS '[规] MPOB 申请要附证明至少种了 2 年的表格（Borang MPOB (PK)）；EUDR 以 2020-12-31 为毁林截止日';
COMMENT ON COLUMN plots.status IS '[约] 红黄绿状态，与线框图、流程图一致。只有 AI 服务在评估完成时更新';
COMMENT ON COLUMN plots.geometry_recorded_at IS '[系] 圈完地块的时间';
COMMENT ON COLUMN plots.last_assessed_at IS '[系] 最近一次评估完成时间';
COMMENT ON COLUMN plots.is_synthetic IS '[系] 是否模拟数据。演示用的 200 个地块全部为 true，避免被误当成真实记录';
COMMENT ON COLUMN plots.created_at IS '[系] 建立时间';
COMMENT ON COLUMN plots.updated_at IS '[系] 最后修改时间';
COMMENT ON TABLE plots IS '地块（EUDR plot of land）';
COMMENT ON COLUMN documents.id IS '[系] 主键';
COMMENT ON COLUMN documents.plot_id IS '[系] 属于哪块地';
COMMENT ON COLUMN documents.doc_type IS '[约] 三种主要文件，加上团体证书的成员名单页（队友文档待商榷项：团体证书不写个人）';
COMMENT ON COLUMN documents.page_no IS '[证] 地契是多页的（Form 5E 有「continuation leaf」续页）';
COMMENT ON COLUMN documents.is_current IS '[系] 重拍后旧照片改为 false，不删除';
COMMENT ON COLUMN documents.storage_path IS '[系] Cloud Storage 路径（签名网址直传）';
COMMENT ON COLUMN documents.mime_type IS '[系] 照片格式';
COMMENT ON COLUMN documents.sha256 IS '[系] 文件指纹，证明评估时看的就是这张图（合规审计）';
COMMENT ON COLUMN documents.source IS '[系] 相机、相册，或模拟数据脚本生成';
COMMENT ON COLUMN documents.uploaded_by IS '[系] 谁上传的（外勤替园主上传时可区分）';
COMMENT ON COLUMN documents.captured_at IS '[系] 拍摄时间';
COMMENT ON COLUMN documents.extraction_status IS '[系] AI 读取进度；失败降级为需人工复核';
COMMENT ON COLUMN documents.extracted_at IS '[系] 读取完成时间';
COMMENT ON COLUMN documents.model_version IS '[系] 读取用的模型版本，供追溯';
COMMENT ON COLUMN documents.is_synthetic IS '[系] 是否模拟数据。演示用的 200 个地块全部为 true，避免被误当成真实记录';
COMMENT ON COLUMN documents.created_at IS '[系] 建立时间';
COMMENT ON TABLE documents IS '用户上传的文件（照片）';
COMMENT ON COLUMN document_fields.id IS '[系] 主键';
COMMENT ON COLUMN document_fields.document_id IS '[系] 来自哪张照片';
COMMENT ON COLUMN document_fields.field_key IS '[系] 字段名，如 land_title.lot_no（完整清单见下表）';
COMMENT ON COLUMN document_fields.raw_text IS '[系] 照片上读到的原文；身份证号只存打码后的形式';
COMMENT ON COLUMN document_fields.normalized_value IS '[系] 标准化后的值（日期转 ISO、面积转公顷等）';
COMMENT ON COLUMN document_fields.confidence IS '[系] Gemini 给出的置信度；低于阈值要请用户确认';
COMMENT ON COLUMN document_fields.confirmed_value IS '[系] 用户在屏 8 确认或改过的值，优先于 normalized_value';
COMMENT ON COLUMN document_fields.confirmed_by IS '[系] 谁确认的';
COMMENT ON COLUMN document_fields.confirmed_at IS '[系] 确认时间';
COMMENT ON COLUMN document_fields.created_at IS '[系] 建立时间';
COMMENT ON TABLE document_fields IS '文件里读出的字段';
COMMENT ON COLUMN assessments.id IS '[系] 主键';
COMMENT ON COLUMN assessments.plot_id IS '[系] 评估哪块地';
COMMENT ON COLUMN assessments.run_status IS '[系] 任务进度（评估中页面读它）';
COMMENT ON COLUMN assessments.result IS '[约] 综合结论，同步写到 plots.status';
COMMENT ON COLUMN assessments.started_at IS '[系] 开始时间';
COMMENT ON COLUMN assessments.finished_at IS '[系] 结束时间（目标约 2 分钟内）';
COMMENT ON COLUMN assessments.model_version IS '[系] Gemini 模型版本';
COMMENT ON COLUMN assessments.rules_version IS '[系] 规则引擎版本';
COMMENT ON COLUMN assessments.input_snapshot IS '[系] 评估时用到的字段值快照，事后能复现结论';
COMMENT ON COLUMN assessments.forest_dataset IS '[待] 森林初筛用的 Earth Engine 数据集名称；准确编号与版本待核实';
COMMENT ON COLUMN assessments.forest_cover_2020_pct IS '[规] EUDR 以 2020-12-31 为基准，看 2020 年底这块地是否为森林';
COMMENT ON COLUMN assessments.forest_loss_after_2020_ha IS '[规] 2020 年之后的森林损失面积（公顷）';
COMMENT ON COLUMN assessments.forest_risk IS '[约] 森林风险等级；查询失败为 unknown，并降级为需人工复核';
COMMENT ON COLUMN assessments.summary_text IS '[系] Gemini 写的白话解释';
COMMENT ON COLUMN assessments.summary_lang IS '[系] 解释语言';
COMMENT ON COLUMN assessments.error_message IS '[系] 失败原因（供排查，不给园主看）';
COMMENT ON COLUMN assessments.is_synthetic IS '[系] 是否模拟数据。演示用的 200 个地块全部为 true，避免被误当成真实记录';
COMMENT ON COLUMN assessments.created_at IS '[系] 建立时间';
COMMENT ON TABLE assessments IS '评估';
COMMENT ON COLUMN rule_results.id IS '[系] 主键';
COMMENT ON COLUMN rule_results.assessment_id IS '[系] 属于哪次评估';
COMMENT ON COLUMN rule_results.rule_code IS '[约] 队友文档的规则编号：CC-01 面积、CC-02 有效期、CC-03 姓名（CC-04、CC-05 的内容我没看到）';
COMMENT ON COLUMN rule_results.result IS '[约] 通过、警告、不通过、需人工复核';
COMMENT ON COLUMN rule_results.expected_value IS '[系] 期望值（如地契面积）';
COMMENT ON COLUMN rule_results.actual_value IS '[系] 实际值（如多边形面积）';
COMMENT ON COLUMN rule_results.params_used IS '[系] 这次用的阈值快照，来自 rule_params';
COMMENT ON COLUMN rule_results.evidence IS '[系] 引用了哪些 document_fields，供点开查看';
COMMENT ON COLUMN rule_results.detail IS '[系] 一句话说明';
COMMENT ON COLUMN rule_results.created_at IS '[系] 建立时间';
COMMENT ON TABLE rule_results IS '规则逐条结果';
COMMENT ON COLUMN gaps.id IS '[系] 主键';
COMMENT ON COLUMN gaps.assessment_id IS '[系] 属于哪次评估';
COMMENT ON COLUMN gaps.gap_code IS '[约] 缺口类别，如 missing_doc、expired、name_mismatch、area_mismatch';
COMMENT ON COLUMN gaps.severity IS '[约] 轻重';
COMMENT ON COLUMN gaps.doc_type IS '[系] 需要补哪类文件（如有）';
COMMENT ON COLUMN gaps.description IS '[系] 问题说明（白话）';
COMMENT ON COLUMN gaps.suggested_action IS '[系] 建议怎么补';
COMMENT ON COLUMN gaps.citation IS '[规] 引用的法规条文（如 EUDR 条文号），法规检索拿到才填';
COMMENT ON COLUMN gaps.status IS '[系] 补件后重新评估时更新';
COMMENT ON COLUMN gaps.created_at IS '[系] 建立时间';
COMMENT ON TABLE gaps IS '缺口清单';
COMMENT ON COLUMN rule_params.rule_code IS '[约] 规则编号；EXTRACT、PLOT 为非规则类参数';
COMMENT ON COLUMN rule_params.param_key IS '[约] 参数名';
COMMENT ON COLUMN rule_params.value IS '[约] 数值';
COMMENT ON COLUMN rule_params.unit IS '[系] 单位';
COMMENT ON COLUMN rule_params.basis IS '[约] 依据：law 法规；mpob MPOB 准则；team 团队约定';
COMMENT ON COLUMN rule_params.note IS '[系] 说明';
COMMENT ON COLUMN rule_params.updated_at IS '[系] 最后修改时间';
COMMENT ON TABLE rule_params IS '规则阈值';
COMMENT ON COLUMN audit_log.id IS '[系] 主键';
COMMENT ON COLUMN audit_log.at IS '[系] 时间';
COMMENT ON COLUMN audit_log.actor_user_id IS '[系] 谁';
COMMENT ON COLUMN audit_log.action IS '[系] 做了什么（create / update / confirm / export）';
COMMENT ON COLUMN audit_log.entity_type IS '[系] 对象类型（表名）';
COMMENT ON COLUMN audit_log.entity_id IS '[系] 对象主键';
COMMENT ON COLUMN audit_log.detail IS '[系] 变更内容';
COMMENT ON TABLE audit_log IS '操作审计';

-- 规则阈值（basis：law 法规 / mpob MPOB 准则 / team 团队约定）
INSERT INTO rule_params (rule_code, param_key, value, unit, basis, note) VALUES
  ('CC-01', 'area_tolerance_pct', 10, '%', 'team', '允许的面积差：地契面积的 10% 与 0.1 公顷取较大者（队友文档）'),
  ('CC-01', 'area_tolerance_min_ha', 0.1, 'ha', 'team', '同上，下限 0.1 公顷'),
  ('CC-01', 'area_fail_over_pct', 50, '%', 'team', '超出 50% 直接不通过（队友文档）'),
  ('CC-02', 'expiry_warn_days', 90, 'days', 'team', '距到期不足 90 天给警告（队友文档）'),
  ('CC-03', 'name_similarity_min', 0.85, 'ratio', 'team', '姓名相似度不低于 0.85 算同一人（队友文档）'),
  ('EXTRACT', 'confidence_min', 0.7, 'ratio', 'team', '读出置信度低于 0.7 要请用户确认（队友文档）'),
  ('PLOT', 'point_max_ha', 4, 'ha', 'law', 'EUDR：小于 4 公顷可只给一个点；恰好 4 公顷各来源写法不一，保守按多边形'),
  ('PLOT', 'smallholder_max_ha', 40.46, 'ha', 'mpob', 'MPOB 小园主执照：100 英亩（40.46 公顷）以下');

-- =====================================================================
-- 演示数据（虚构）：一绿、一黄、一红。今天按 2026-10-08 算。
-- =====================================================================
INSERT INTO cooperatives (id, name, registration_body, state, is_synthetic) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'Koperasi Pekebun Kecil Contoh (虚构)', 'SKM', 'Perak', true);

INSERT INTO persons (id, full_name, ic_hash, ic_last4, is_synthetic) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'TAN AH KOW',          encode(sha256('720304075117'::bytea), 'hex'), '5117', true),
  ('a0000000-0000-4000-8000-000000000002', 'AHMAD ZAKI BIN ROSLI',encode(sha256('800512085231'::bytea), 'hex'), '5231', true),
  ('a0000000-0000-4000-8000-000000000003', 'MUTHU A/L RAMAN',    encode(sha256('650820015333'::bytea), 'hex'), '5333', true);

INSERT INTO users (id, phone, role, language, person_id, coop_id, is_synthetic) VALUES
  ('demo-officer-1', '+60100000001', 'field_officer', 'ms', NULL, 'c0000000-0000-4000-8000-000000000001', true),
  ('demo-admin-1',   '+60100000002', 'coop_admin',    'en', NULL, 'c0000000-0000-4000-8000-000000000001', true);

-- 地契
INSERT INTO land_titles (id, title_type, title_no, lot_no, mukim, district, state, area_value, area_unit,
                         land_use_category, tenure, express_conditions, special_area_type, verification_level, is_synthetic) VALUES
  ('b0000000-0000-4000-8000-000000000001', 'GRN', 'GRN 51234',   '1052', 'Kampar', 'Kampar', 'Perak', 4.2000, 'ha', 'agriculture', 'freehold', 'Tanah ini hendaklah digunakan bagi pertanian sahaja', 'none', 'confirmed', true),
  ('b0000000-0000-4000-8000-000000000002', 'HSM', 'HSM 2217/91', '2217', 'Kampar', 'Kampar', 'Perak', 3.0400, 'ha', 'agriculture', 'freehold', 'Tanah ini hendaklah digunakan bagi pertanian sahaja', 'none', 'confirmed', true),
  ('b0000000-0000-4000-8000-000000000003', 'GRN', 'GRN 30977',   '88',   'Kampar', 'Kampar', 'Perak', 2.0000, 'ha', 'agriculture', 'freehold', 'Tanah ini hendaklah digunakan bagi pertanian sahaja', 'none', 'extracted', true);

-- 地契登记持有人：红色那块地还在已故父亲名下（tanah pusaka）
INSERT INTO title_proprietors (land_title_id, seq, name_as_printed, ic_hash, ic_last4, person_id, is_synthetic) VALUES
  ('b0000000-0000-4000-8000-000000000001', 1, 'TAN AH KOW',           encode(sha256('720304075117'::bytea), 'hex'), '5117', 'a0000000-0000-4000-8000-000000000001', true),
  ('b0000000-0000-4000-8000-000000000002', 1, 'AHMAD ZAKI BIN ROSLI', encode(sha256('800512085231'::bytea), 'hex'), '5231', 'a0000000-0000-4000-8000-000000000002', true),
  ('b0000000-0000-4000-8000-000000000003', 1, 'RAMAN A/L SUBRAMANIAM',encode(sha256('391101015009'::bytea), 'hex'), '5009', NULL, true);

-- MPOB 执照
INSERT INTO mpob_licences (id, licence_no, holder_name, holder_ic_hash, holder_ic_last4, holder_person_id, valid_until, verification_level, is_synthetic) VALUES
  ('d0000000-0000-4000-8000-000000000001', '810200000011', 'TAN AH KOW',           encode(sha256('720304075117'::bytea), 'hex'), '5117', 'a0000000-0000-4000-8000-000000000001', '2027-03-31', 'confirmed', true),
  ('d0000000-0000-4000-8000-000000000002', '810200000022', 'AHMAD ZAKI BIN ROSLI', encode(sha256('800512085231'::bytea), 'hex'), '5231', 'a0000000-0000-4000-8000-000000000002', '2026-12-05', 'confirmed', true),
  ('d0000000-0000-4000-8000-000000000003', '810200000033', 'MUTHU A/L RAMAN',     encode(sha256('650820015333'::bytea), 'hex'), '5333', 'a0000000-0000-4000-8000-000000000003', '2026-04-30', 'extracted', true);

-- MSPO 团体证书与成员名单（红色那块地的园主不在名单上）
INSERT INTO mspo_certificates (id, cert_no, certificate_holder, certification_unit, standard, scope, start_date, first_certified_date, expiry_date, members_count, is_synthetic) VALUES
  ('e0000000-0000-4000-8000-000000000001', 'MSPO 900001', 'Contoh Sawit Sdn. Bhd. (虚构)',
   'Contoh Group Scheme - Perak Smallholders (2 members)', 'MS 2530-2:2013 General Principles for Independent Smallholders',
   'estate', '2024-03-01', '2019-03-01', '2029-02-28', 2, true);
INSERT INTO mspo_members (id, certificate_id, member_no, member_name, plot_no, land_title_text, mpob_licence_no, person_id, land_title_id, is_synthetic) VALUES
  ('f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 1, 'TAN AH KOW',           'P1', 'Lot 1052 No. GRN 51234 - 4.200ha, Kampar, Agriculture. Perpetuity ownership.',  '810200000011', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', true),
  ('f0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 2, 'AHMAD ZAKI BIN ROSLI', 'P2', 'Lot 2217 No. HSM 2217/91 - 3.040ha, Kampar, Agriculture. Perpetuity ownership.', '810200000022', 'a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', true);

-- 地块（绿 / 黄 / 红）
INSERT INTO plots (id, nickname, operator_person_id, coop_id, land_title_id, mpob_licence_id, mspo_member_id, geometry_type,
                   centroid_lat, centroid_lng, polygon_geojson, area_ha_computed, oil_palm_planted_year, status, geometry_recorded_at, last_assessed_at, is_synthetic) VALUES
  ('90000000-0000-4000-8000-000000000001', 'Kebun Utama',  'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001',
   'polygon', 4.310000, 101.150000, '{"type": "Polygon", "coordinates": [[[101.149037, 4.309105], [101.150963, 4.309105], [101.150963, 4.310895], [101.149037, 4.310895], [101.149037, 4.309105]]]}', 4.2300, 2008, 'green',  '2026-10-02 09:10+08', '2026-10-02 09:14+08', true),
  ('90000000-0000-4000-8000-000000000002', 'Kebun Belakang','a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000002',
   'polygon', 4.325000, 101.162000, '{"type": "Polygon", "coordinates": [[[101.161125, 4.324187], [101.162875, 4.324187], [101.162875, 4.325813], [101.161125, 4.325813], [101.161125, 4.324187]]]}', 3.4900, 2012, 'yellow', '2026-10-03 10:20+08', '2026-10-03 10:24+08', true),
  ('90000000-0000-4000-8000-000000000003', 'Kebun Arwah Ayah','a0000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000003', NULL,
   'polygon', 4.298000, 101.141000, '{"type": "Polygon", "coordinates": [[[101.140137, 4.297198], [101.141863, 4.297198], [101.141863, 4.298802], [101.140137, 4.298802], [101.140137, 4.297198]]]}', 3.4000, 2015, 'red',    '2026-10-04 15:02+08', '2026-10-04 15:07+08', true);

-- 黄色地块的文件与读出的字段（示意：完整清单见企划书 8.6 节）
INSERT INTO documents (id, plot_id, doc_type, page_no, storage_path, extraction_status, model_version, source, is_synthetic) VALUES
  ('80000000-0000-4000-8000-000000000021', '90000000-0000-4000-8000-000000000002', 'land_title',    1, 'seed/p2/title-1.jpg',   'extracted', 'demo', 'seed', true),
  ('80000000-0000-4000-8000-000000000022', '90000000-0000-4000-8000-000000000002', 'land_title',    2, 'seed/p2/title-2.jpg',   'extracted', 'demo', 'seed', true),
  ('80000000-0000-4000-8000-000000000023', '90000000-0000-4000-8000-000000000002', 'mpob_licence',  1, 'seed/p2/licence-1.jpg', 'extracted', 'demo', 'seed', true);
UPDATE land_titles    SET source_document_id = '80000000-0000-4000-8000-000000000021' WHERE id = 'b0000000-0000-4000-8000-000000000002';
UPDATE mpob_licences  SET source_document_id = '80000000-0000-4000-8000-000000000023' WHERE id = 'd0000000-0000-4000-8000-000000000002';
INSERT INTO document_fields (document_id, field_key, raw_text, normalized_value, confidence) VALUES
  ('80000000-0000-4000-8000-000000000021', 'land_title.lot_no',     '2217',        '2217',   0.97),
  ('80000000-0000-4000-8000-000000000021', 'land_title.area_value', '3.04 Hektar', '3.0400', 0.93),
  ('80000000-0000-4000-8000-000000000021', 'land_title.area_unit',  'Hektar',      'ha',     0.95),
  ('80000000-0000-4000-8000-000000000022', 'land_title.proprietor_1_name', 'AHMAD ZAKI BIN ROSLI', 'AHMAD ZAKI BIN ROSLI', 0.88),
  ('80000000-0000-4000-8000-000000000022', 'land_title.proprietor_1_ic',   '******-**-5231',      '5231',                 0.90),
  ('80000000-0000-4000-8000-000000000023', 'mpob_licence.valid_until',     '05/12/2026',          '2026-12-05',           0.64);
UPDATE document_fields SET confirmed_value = '2026-12-05', confirmed_by = 'demo-officer-1', confirmed_at = now()
 WHERE field_key = 'mpob_licence.valid_until';   -- 置信度 0.64 < 0.70，要用户确认

-- 评估（只有 AI 服务会写这几张表）
INSERT INTO assessments (id, plot_id, run_status, result, started_at, finished_at, model_version, rules_version,
                         forest_cover_2020_pct, forest_loss_after_2020_ha, forest_risk, summary_text, summary_lang, is_synthetic) VALUES
  ('70000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', 'done', 'green',  '2026-10-02 09:12+08', '2026-10-02 09:14+08', 'demo', 'rules-0.1', 0, 0, 'low',  'Semua semakan lulus.', 'ms', true),
  ('70000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000002', 'done', 'yellow', '2026-10-03 10:22+08', '2026-10-03 10:24+08', 'demo', 'rules-0.1', 0, 0, 'low',  'Luas pada peta lebih besar daripada geran, dan lesen MPOB hampir tamat.', 'ms', true),
  ('70000000-0000-4000-8000-000000000003', '90000000-0000-4000-8000-000000000003', 'done', 'red',    '2026-10-04 15:05+08', '2026-10-04 15:07+08', 'demo', 'rules-0.1', 12.5, 0.8, 'high', 'Lesen MPOB telah tamat, geran atas nama arwah ayah, dan luas jauh berbeza.', 'ms', true);

INSERT INTO rule_results (assessment_id, rule_code, result, expected_value, actual_value, params_used, detail) VALUES
  ('70000000-0000-4000-8000-000000000001', 'CC-01', 'pass', '4.2000 ha', '4.2300 ha', '{"tol_pct":10,"tol_min_ha":0.1}', '差 0.03 公顷，在允许范围内'),
  ('70000000-0000-4000-8000-000000000001', 'CC-02', 'pass', '>= 90 天', '174 天', '{"warn_days":90}', 'MPOB 执照 2027-03-31 到期'),
  ('70000000-0000-4000-8000-000000000001', 'CC-03', 'pass', '>= 0.85', '1.00', '{"min_similarity":0.85}', '地契、执照、名单上的姓名一致'),
  ('70000000-0000-4000-8000-000000000002', 'CC-01', 'warn', '3.0400 ha', '3.4900 ha', '{"tol_pct":10,"tol_min_ha":0.1}', '多出 0.45 公顷（+14.8%），超过允许的 0.304 公顷'),
  ('70000000-0000-4000-8000-000000000002', 'CC-02', 'warn', '>= 90 天', '58 天', '{"warn_days":90}', 'MPOB 执照 2026-12-05 到期'),
  ('70000000-0000-4000-8000-000000000002', 'CC-03', 'pass', '>= 0.85', '1.00', '{"min_similarity":0.85}', '姓名一致'),
  ('70000000-0000-4000-8000-000000000003', 'CC-01', 'fail', '2.0000 ha', '3.4000 ha', '{"tol_pct":10,"tol_min_ha":0.1,"fail_over_pct":50}', '多出 70%，超过 50% 红线'),
  ('70000000-0000-4000-8000-000000000003', 'CC-02', 'fail', '未过期', '2026-04-30 已过期', '{"warn_days":90}', 'MPOB 执照已过期'),
  ('70000000-0000-4000-8000-000000000003', 'CC-03', 'fail', '>= 0.85', '0.21', '{"min_similarity":0.85}', '地契持有人是 RAMAN A/L SUBRAMANIAM，与种地的人不同');

INSERT INTO gaps (assessment_id, gap_code, severity, doc_type, description, suggested_action) VALUES
  ('70000000-0000-4000-8000-000000000002', 'area_mismatch', 'medium', NULL, '地图量出的面积比地契多 0.45 公顷', '重新圈一次边界，或确认地契面积是否已有分割'),
  ('70000000-0000-4000-8000-000000000002', 'expiring', 'medium', 'mpob_licence', 'MPOB 执照 58 天后到期', '提前向 MPOB 申请续期，续期后重新拍照上传'),
  ('70000000-0000-4000-8000-000000000003', 'expired', 'high', 'mpob_licence', 'MPOB 执照已过期', '先续期（逾期要付 fi lewat / fi tamat tempoh），再上传新执照'),
  ('70000000-0000-4000-8000-000000000003', 'name_mismatch', 'high', 'land_title', '地契仍在已故父亲名下', '准备继承（pusaka）文件或授权书 / 授权委托书，再上传'),
  ('70000000-0000-4000-8000-000000000003', 'area_mismatch', 'high', NULL, '地图面积比地契多 70%', '核对地界；如已买入相邻土地，补上相邻地契'),
  ('70000000-0000-4000-8000-000000000003', 'not_in_mspo', 'medium', 'mspo_member_list', '园主不在 MSPO 团体成员名单上', '向合作社确认是否已加入团体认证');

COMMIT;
