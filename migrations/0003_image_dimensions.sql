-- COCO export에 필요한 원본 이미지 크기 저장
ALTER TABLE labels ADD COLUMN image_width INTEGER;
ALTER TABLE labels ADD COLUMN image_height INTEGER;
