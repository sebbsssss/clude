import 'package:freezed_annotation/freezed_annotation.dart';

part 'entity_data.freezed.dart';
part 'entity_data.g.dart';

@freezed
class GraphEntity with _$GraphEntity {
  const factory GraphEntity({
    required int id,
    required String type,
    required String name,
    @Default([]) List<String> aliases,
    @Default('') String description,
    @JsonKey(name: 'mentionCount') @Default(0) int mentionCount,
    @JsonKey(name: 'firstSeen') String? firstSeen,
    @JsonKey(name: 'lastSeen') String? lastSeen,
  }) = _GraphEntity;

  factory GraphEntity.fromJson(Map<String, dynamic> json) =>
      _$GraphEntityFromJson(json);
}

@freezed
class EntityMemory with _$EntityMemory {
  const factory EntityMemory({
    required int id,
    required String type,
    required String summary,
    required double importance,
    @JsonKey(name: 'createdAt') required String createdAt,
  }) = _EntityMemory;

  factory EntityMemory.fromJson(Map<String, dynamic> json) =>
      _$EntityMemoryFromJson(json);
}

@freezed
class RelatedEntity with _$RelatedEntity {
  const factory RelatedEntity({
    @JsonKey(name: 'entityId') required int entityId,
    @JsonKey(name: 'cooccurrenceCount') @Default(0) int cooccurrenceCount,
    @JsonKey(name: 'avgSalience') @Default(0.0) double avgSalience,
  }) = _RelatedEntity;

  factory RelatedEntity.fromJson(Map<String, dynamic> json) =>
      _$RelatedEntityFromJson(json);
}

@freezed
class EntityDetail with _$EntityDetail {
  const factory EntityDetail({
    required GraphEntity entity,
    @Default([]) List<EntityMemory> memories,
    @Default([]) List<RelatedEntity> relatedEntities,
  }) = _EntityDetail;

  factory EntityDetail.fromJson(Map<String, dynamic> json) =>
      _$EntityDetailFromJson(json);
}
