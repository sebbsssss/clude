// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'memory_stats.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_$TagCountImpl _$$TagCountImplFromJson(Map<String, dynamic> json) =>
    _$TagCountImpl(
      tag: json['tag'] as String,
      count: (json['count'] as num).toInt(),
    );

Map<String, dynamic> _$$TagCountImplToJson(_$TagCountImpl instance) =>
    <String, dynamic>{'tag': instance.tag, 'count': instance.count};

_$MemoryStatsImpl _$$MemoryStatsImplFromJson(Map<String, dynamic> json) =>
    _$MemoryStatsImpl(
      total: (json['total'] as num).toInt(),
      byType: Map<String, int>.from(json['byType'] as Map),
      avgImportance: (json['avgImportance'] as num).toDouble(),
      avgDecay: (json['avgDecay'] as num).toDouble(),
      topTags: (json['topTags'] as List<dynamic>)
          .map((e) => TagCount.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$$MemoryStatsImplToJson(_$MemoryStatsImpl instance) =>
    <String, dynamic>{
      'total': instance.total,
      'byType': instance.byType,
      'avgImportance': instance.avgImportance,
      'avgDecay': instance.avgDecay,
      'topTags': instance.topTags,
    };
