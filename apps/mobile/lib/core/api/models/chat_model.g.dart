// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'chat_model.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_$ModelCostImpl _$$ModelCostImplFromJson(Map<String, dynamic> json) =>
    _$ModelCostImpl(
      input: (json['input'] as num).toDouble(),
      output: (json['output'] as num).toDouble(),
    );

Map<String, dynamic> _$$ModelCostImplToJson(_$ModelCostImpl instance) =>
    <String, dynamic>{'input': instance.input, 'output': instance.output};

_$ChatModelImpl _$$ChatModelImplFromJson(Map<String, dynamic> json) =>
    _$ChatModelImpl(
      id: json['id'] as String,
      name: json['name'] as String,
      privacy: json['privacy'] as String,
      context: (json['context'] as num).toInt(),
      isDefault: json['default'] as bool? ?? false,
      tier: json['tier'] as String,
      cost: ModelCost.fromJson(json['cost'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$$ChatModelImplToJson(_$ChatModelImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'name': instance.name,
      'privacy': instance.privacy,
      'context': instance.context,
      'default': instance.isDefault,
      'tier': instance.tier,
      'cost': instance.cost,
    };
