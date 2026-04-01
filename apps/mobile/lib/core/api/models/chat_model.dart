import 'package:freezed_annotation/freezed_annotation.dart';

part 'chat_model.freezed.dart';
part 'chat_model.g.dart';

@freezed
class ModelCost with _$ModelCost {
  const factory ModelCost({
    required double input,
    required double output,
  }) = _ModelCost;

  factory ModelCost.fromJson(Map<String, dynamic> json) =>
      _$ModelCostFromJson(json);
}

@freezed
class ChatModel with _$ChatModel {
  const factory ChatModel({
    required String id,
    required String name,
    required String privacy,
    required int context,
    @JsonKey(name: 'default') @Default(false) bool isDefault,
    required String tier,
    required ModelCost cost,
  }) = _ChatModel;

  factory ChatModel.fromJson(Map<String, dynamic> json) =>
      _$ChatModelFromJson(json);
}
