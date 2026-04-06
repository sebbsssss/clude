// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'entity_data.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_$GraphEntityImpl _$$GraphEntityImplFromJson(Map<String, dynamic> json) =>
    _$GraphEntityImpl(
      id: (json['id'] as num).toInt(),
      type: json['type'] as String,
      name: json['name'] as String,
      aliases:
          (json['aliases'] as List<dynamic>?)
              ?.map((e) => e as String)
              .toList() ??
          const [],
      description: json['description'] as String? ?? '',
      mentionCount: (json['mentionCount'] as num?)?.toInt() ?? 0,
      firstSeen: json['firstSeen'] as String?,
      lastSeen: json['lastSeen'] as String?,
    );

Map<String, dynamic> _$$GraphEntityImplToJson(_$GraphEntityImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'type': instance.type,
      'name': instance.name,
      'aliases': instance.aliases,
      'description': instance.description,
      'mentionCount': instance.mentionCount,
      'firstSeen': instance.firstSeen,
      'lastSeen': instance.lastSeen,
    };

_$EntityMemoryImpl _$$EntityMemoryImplFromJson(Map<String, dynamic> json) =>
    _$EntityMemoryImpl(
      id: (json['id'] as num).toInt(),
      type: json['type'] as String,
      summary: json['summary'] as String,
      importance: (json['importance'] as num).toDouble(),
      createdAt: json['createdAt'] as String,
    );

Map<String, dynamic> _$$EntityMemoryImplToJson(_$EntityMemoryImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'type': instance.type,
      'summary': instance.summary,
      'importance': instance.importance,
      'createdAt': instance.createdAt,
    };

_$RelatedEntityImpl _$$RelatedEntityImplFromJson(Map<String, dynamic> json) =>
    _$RelatedEntityImpl(
      entityId: (json['entityId'] as num).toInt(),
      cooccurrenceCount: (json['cooccurrenceCount'] as num?)?.toInt() ?? 0,
      avgSalience: (json['avgSalience'] as num?)?.toDouble() ?? 0.0,
    );

Map<String, dynamic> _$$RelatedEntityImplToJson(_$RelatedEntityImpl instance) =>
    <String, dynamic>{
      'entityId': instance.entityId,
      'cooccurrenceCount': instance.cooccurrenceCount,
      'avgSalience': instance.avgSalience,
    };

_$EntityDetailImpl _$$EntityDetailImplFromJson(Map<String, dynamic> json) =>
    _$EntityDetailImpl(
      entity: GraphEntity.fromJson(json['entity'] as Map<String, dynamic>),
      memories:
          (json['memories'] as List<dynamic>?)
              ?.map((e) => EntityMemory.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const [],
      relatedEntities:
          (json['relatedEntities'] as List<dynamic>?)
              ?.map((e) => RelatedEntity.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const [],
    );

Map<String, dynamic> _$$EntityDetailImplToJson(_$EntityDetailImpl instance) =>
    <String, dynamic>{
      'entity': instance.entity,
      'memories': instance.memories,
      'relatedEntities': instance.relatedEntities,
    };
