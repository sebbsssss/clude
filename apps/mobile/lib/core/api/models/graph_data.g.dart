// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'graph_data.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_$GraphNodeImpl _$$GraphNodeImplFromJson(Map<String, dynamic> json) =>
    _$GraphNodeImpl(
      id: (json['id'] as num).toInt(),
      type: json['type'] as String,
      summary: json['summary'] as String,
      content: json['content'] as String? ?? '',
      tags:
          (json['tags'] as List<dynamic>?)?.map((e) => e as String).toList() ??
          const [],
      importance: (json['importance'] as num).toDouble(),
      decay: (json['decay'] as num?)?.toDouble() ?? 0.5,
    );

Map<String, dynamic> _$$GraphNodeImplToJson(_$GraphNodeImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'type': instance.type,
      'summary': instance.summary,
      'content': instance.content,
      'tags': instance.tags,
      'importance': instance.importance,
      'decay': instance.decay,
    };

_$GraphLinkImpl _$$GraphLinkImplFromJson(Map<String, dynamic> json) =>
    _$GraphLinkImpl(
      sourceId: (json['source_id'] as num).toInt(),
      targetId: (json['target_id'] as num).toInt(),
      linkType: json['link_type'] as String,
      strength: (json['strength'] as num?)?.toDouble() ?? 0.5,
    );

Map<String, dynamic> _$$GraphLinkImplToJson(_$GraphLinkImpl instance) =>
    <String, dynamic>{
      'source_id': instance.sourceId,
      'target_id': instance.targetId,
      'link_type': instance.linkType,
      'strength': instance.strength,
    };

_$GraphDataImpl _$$GraphDataImplFromJson(Map<String, dynamic> json) =>
    _$GraphDataImpl(
      nodes: (json['nodes'] as List<dynamic>)
          .map((e) => GraphNode.fromJson(e as Map<String, dynamic>))
          .toList(),
      links: (json['links'] as List<dynamic>)
          .map((e) => GraphLink.fromJson(e as Map<String, dynamic>))
          .toList(),
      total: (json['total'] as num).toInt(),
    );

Map<String, dynamic> _$$GraphDataImplToJson(_$GraphDataImpl instance) =>
    <String, dynamic>{
      'nodes': instance.nodes,
      'links': instance.links,
      'total': instance.total,
    };
