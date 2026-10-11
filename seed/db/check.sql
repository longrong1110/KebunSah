-- 自检：数据库里的约束真的会拦下不该写入的数据。
-- 每一项都在子事务里尝试写入，被拒绝（预期）就打印 OK，没被拒绝就打印 FAIL；最后整个脚本回滚，不留任何改动。
-- 运行：  npm run db:check   （在 seed/ 下）
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  who uuid := '00000000-0000-4000-8000-0000000000aa';
BEGIN
  INSERT INTO persons (id, full_name, is_synthetic) VALUES (who, 'UJIAN BIN UJIAN', true);

  -- 1. 5 公顷只记一个点：4 公顷以上必须是多边形
  BEGIN
    INSERT INTO plots (operator_person_id, geometry_type, centroid_lat, centroid_lng, area_ha_declared, is_synthetic)
    VALUES (who, 'point', 4.3, 101.1, 5, true);
    RAISE NOTICE 'FAIL  1 5 公顷只记一个点没有被拒绝';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'OK    1 5 公顷只记一个点被拒绝';
  END;

  -- 2. 多边形却没有边界与计算面积
  BEGIN
    INSERT INTO plots (operator_person_id, geometry_type, is_synthetic) VALUES (who, 'polygon', true);
    RAISE NOTICE 'FAIL  2 没有边界的多边形没有被拒绝';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'OK    2 没有边界的多边形被拒绝';
  END;

  -- 3. 状态值只能是合同里的五个
  BEGIN
    INSERT INTO plots (operator_person_id, status, is_synthetic) VALUES (who, 'orange', true);
    RAISE NOTICE 'FAIL  3 非法状态值没有被拒绝';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'OK    3 非法状态值被拒绝';
  END;

  -- 4. 面积必须大于 0
  BEGIN
    INSERT INTO plots (operator_person_id, geometry_type, centroid_lat, centroid_lng, area_ha_declared, is_synthetic)
    VALUES (who, 'point', 4.3, 101.1, 0, true);
    RAISE NOTICE 'FAIL  4 面积为 0 没有被拒绝';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'OK    4 面积为 0 被拒绝';
  END;

  -- 5. 手机号必须是 +国际区号开头
  BEGIN
    INSERT INTO users (id, phone, role, is_synthetic) VALUES ('ujian-1', '0123456789', 'smallholder', true);
    RAISE NOTICE 'FAIL  5 不带 + 的手机号没有被拒绝';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'OK    5 不带 + 的手机号被拒绝';
  END;

  -- 6. 角色只能是三种
  BEGIN
    INSERT INTO users (id, phone, role, is_synthetic) VALUES ('ujian-2', '+60123456789', 'boss', true);
    RAISE NOTICE 'FAIL  6 非法角色没有被拒绝';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'OK    6 非法角色被拒绝';
  END;

  -- 7. 身份证只存后四位，必须是 4 个数字
  BEGIN
    INSERT INTO persons (full_name, ic_last4, is_synthetic) VALUES ('UJIAN', 'AB12', true);
    RAISE NOTICE 'FAIL  7 非数字的身份证后四位没有被拒绝';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'OK    7 非数字的身份证后四位被拒绝';
  END;
END $$;

ROLLBACK;
