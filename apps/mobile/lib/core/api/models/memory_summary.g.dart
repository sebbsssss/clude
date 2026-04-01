// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'memory_summary.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_$MemorySummaryImpl _$$MemorySummaryImplFromJson(Map<String, dynamic> json) =>
    _$MemorySummaryImpl(
      id: (json['id'] as num).toInt(),
      memoryType: json['memory_type'] as String,
      summary: json['summary'] as String,
      importance: (json['importance'] as num).toDouble(),
      createdAt: json['created_at'] as String,
    );

Map<String, dynamic> _$$MemorySummaryImplToJson(_$MemorySummaryImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'memory_type': instance.memoryType,
      'summary': instance.summary,
      'importance': instance.importance,
      'created_at': instance.createdAt,
    };
