// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'chat_model.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
  'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models',
);

ModelCost _$ModelCostFromJson(Map<String, dynamic> json) {
  return _ModelCost.fromJson(json);
}

/// @nodoc
mixin _$ModelCost {
  double get input => throw _privateConstructorUsedError;
  double get output => throw _privateConstructorUsedError;

  /// Serializes this ModelCost to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of ModelCost
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $ModelCostCopyWith<ModelCost> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $ModelCostCopyWith<$Res> {
  factory $ModelCostCopyWith(ModelCost value, $Res Function(ModelCost) then) =
      _$ModelCostCopyWithImpl<$Res, ModelCost>;
  @useResult
  $Res call({double input, double output});
}

/// @nodoc
class _$ModelCostCopyWithImpl<$Res, $Val extends ModelCost>
    implements $ModelCostCopyWith<$Res> {
  _$ModelCostCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of ModelCost
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({Object? input = null, Object? output = null}) {
    return _then(
      _value.copyWith(
            input: null == input
                ? _value.input
                : input // ignore: cast_nullable_to_non_nullable
                      as double,
            output: null == output
                ? _value.output
                : output // ignore: cast_nullable_to_non_nullable
                      as double,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$ModelCostImplCopyWith<$Res>
    implements $ModelCostCopyWith<$Res> {
  factory _$$ModelCostImplCopyWith(
    _$ModelCostImpl value,
    $Res Function(_$ModelCostImpl) then,
  ) = __$$ModelCostImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({double input, double output});
}

/// @nodoc
class __$$ModelCostImplCopyWithImpl<$Res>
    extends _$ModelCostCopyWithImpl<$Res, _$ModelCostImpl>
    implements _$$ModelCostImplCopyWith<$Res> {
  __$$ModelCostImplCopyWithImpl(
    _$ModelCostImpl _value,
    $Res Function(_$ModelCostImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of ModelCost
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({Object? input = null, Object? output = null}) {
    return _then(
      _$ModelCostImpl(
        input: null == input
            ? _value.input
            : input // ignore: cast_nullable_to_non_nullable
                  as double,
        output: null == output
            ? _value.output
            : output // ignore: cast_nullable_to_non_nullable
                  as double,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$ModelCostImpl implements _ModelCost {
  const _$ModelCostImpl({required this.input, required this.output});

  factory _$ModelCostImpl.fromJson(Map<String, dynamic> json) =>
      _$$ModelCostImplFromJson(json);

  @override
  final double input;
  @override
  final double output;

  @override
  String toString() {
    return 'ModelCost(input: $input, output: $output)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$ModelCostImpl &&
            (identical(other.input, input) || other.input == input) &&
            (identical(other.output, output) || other.output == output));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(runtimeType, input, output);

  /// Create a copy of ModelCost
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$ModelCostImplCopyWith<_$ModelCostImpl> get copyWith =>
      __$$ModelCostImplCopyWithImpl<_$ModelCostImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$ModelCostImplToJson(this);
  }
}

abstract class _ModelCost implements ModelCost {
  const factory _ModelCost({
    required final double input,
    required final double output,
  }) = _$ModelCostImpl;

  factory _ModelCost.fromJson(Map<String, dynamic> json) =
      _$ModelCostImpl.fromJson;

  @override
  double get input;
  @override
  double get output;

  /// Create a copy of ModelCost
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$ModelCostImplCopyWith<_$ModelCostImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

ChatModel _$ChatModelFromJson(Map<String, dynamic> json) {
  return _ChatModel.fromJson(json);
}

/// @nodoc
mixin _$ChatModel {
  String get id => throw _privateConstructorUsedError;
  String get name => throw _privateConstructorUsedError;
  String get privacy => throw _privateConstructorUsedError;
  int get context => throw _privateConstructorUsedError;
  @JsonKey(name: 'default')
  bool get isDefault => throw _privateConstructorUsedError;
  String get tier => throw _privateConstructorUsedError;
  ModelCost get cost => throw _privateConstructorUsedError;

  /// Serializes this ChatModel to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of ChatModel
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $ChatModelCopyWith<ChatModel> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $ChatModelCopyWith<$Res> {
  factory $ChatModelCopyWith(ChatModel value, $Res Function(ChatModel) then) =
      _$ChatModelCopyWithImpl<$Res, ChatModel>;
  @useResult
  $Res call({
    String id,
    String name,
    String privacy,
    int context,
    @JsonKey(name: 'default') bool isDefault,
    String tier,
    ModelCost cost,
  });

  $ModelCostCopyWith<$Res> get cost;
}

/// @nodoc
class _$ChatModelCopyWithImpl<$Res, $Val extends ChatModel>
    implements $ChatModelCopyWith<$Res> {
  _$ChatModelCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of ChatModel
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? name = null,
    Object? privacy = null,
    Object? context = null,
    Object? isDefault = null,
    Object? tier = null,
    Object? cost = null,
  }) {
    return _then(
      _value.copyWith(
            id: null == id
                ? _value.id
                : id // ignore: cast_nullable_to_non_nullable
                      as String,
            name: null == name
                ? _value.name
                : name // ignore: cast_nullable_to_non_nullable
                      as String,
            privacy: null == privacy
                ? _value.privacy
                : privacy // ignore: cast_nullable_to_non_nullable
                      as String,
            context: null == context
                ? _value.context
                : context // ignore: cast_nullable_to_non_nullable
                      as int,
            isDefault: null == isDefault
                ? _value.isDefault
                : isDefault // ignore: cast_nullable_to_non_nullable
                      as bool,
            tier: null == tier
                ? _value.tier
                : tier // ignore: cast_nullable_to_non_nullable
                      as String,
            cost: null == cost
                ? _value.cost
                : cost // ignore: cast_nullable_to_non_nullable
                      as ModelCost,
          )
          as $Val,
    );
  }

  /// Create a copy of ChatModel
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $ModelCostCopyWith<$Res> get cost {
    return $ModelCostCopyWith<$Res>(_value.cost, (value) {
      return _then(_value.copyWith(cost: value) as $Val);
    });
  }
}

/// @nodoc
abstract class _$$ChatModelImplCopyWith<$Res>
    implements $ChatModelCopyWith<$Res> {
  factory _$$ChatModelImplCopyWith(
    _$ChatModelImpl value,
    $Res Function(_$ChatModelImpl) then,
  ) = __$$ChatModelImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    String id,
    String name,
    String privacy,
    int context,
    @JsonKey(name: 'default') bool isDefault,
    String tier,
    ModelCost cost,
  });

  @override
  $ModelCostCopyWith<$Res> get cost;
}

/// @nodoc
class __$$ChatModelImplCopyWithImpl<$Res>
    extends _$ChatModelCopyWithImpl<$Res, _$ChatModelImpl>
    implements _$$ChatModelImplCopyWith<$Res> {
  __$$ChatModelImplCopyWithImpl(
    _$ChatModelImpl _value,
    $Res Function(_$ChatModelImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of ChatModel
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? name = null,
    Object? privacy = null,
    Object? context = null,
    Object? isDefault = null,
    Object? tier = null,
    Object? cost = null,
  }) {
    return _then(
      _$ChatModelImpl(
        id: null == id
            ? _value.id
            : id // ignore: cast_nullable_to_non_nullable
                  as String,
        name: null == name
            ? _value.name
            : name // ignore: cast_nullable_to_non_nullable
                  as String,
        privacy: null == privacy
            ? _value.privacy
            : privacy // ignore: cast_nullable_to_non_nullable
                  as String,
        context: null == context
            ? _value.context
            : context // ignore: cast_nullable_to_non_nullable
                  as int,
        isDefault: null == isDefault
            ? _value.isDefault
            : isDefault // ignore: cast_nullable_to_non_nullable
                  as bool,
        tier: null == tier
            ? _value.tier
            : tier // ignore: cast_nullable_to_non_nullable
                  as String,
        cost: null == cost
            ? _value.cost
            : cost // ignore: cast_nullable_to_non_nullable
                  as ModelCost,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$ChatModelImpl implements _ChatModel {
  const _$ChatModelImpl({
    required this.id,
    required this.name,
    required this.privacy,
    required this.context,
    @JsonKey(name: 'default') this.isDefault = false,
    required this.tier,
    required this.cost,
  });

  factory _$ChatModelImpl.fromJson(Map<String, dynamic> json) =>
      _$$ChatModelImplFromJson(json);

  @override
  final String id;
  @override
  final String name;
  @override
  final String privacy;
  @override
  final int context;
  @override
  @JsonKey(name: 'default')
  final bool isDefault;
  @override
  final String tier;
  @override
  final ModelCost cost;

  @override
  String toString() {
    return 'ChatModel(id: $id, name: $name, privacy: $privacy, context: $context, isDefault: $isDefault, tier: $tier, cost: $cost)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$ChatModelImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.name, name) || other.name == name) &&
            (identical(other.privacy, privacy) || other.privacy == privacy) &&
            (identical(other.context, context) || other.context == context) &&
            (identical(other.isDefault, isDefault) ||
                other.isDefault == isDefault) &&
            (identical(other.tier, tier) || other.tier == tier) &&
            (identical(other.cost, cost) || other.cost == cost));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
    runtimeType,
    id,
    name,
    privacy,
    context,
    isDefault,
    tier,
    cost,
  );

  /// Create a copy of ChatModel
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$ChatModelImplCopyWith<_$ChatModelImpl> get copyWith =>
      __$$ChatModelImplCopyWithImpl<_$ChatModelImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$ChatModelImplToJson(this);
  }
}

abstract class _ChatModel implements ChatModel {
  const factory _ChatModel({
    required final String id,
    required final String name,
    required final String privacy,
    required final int context,
    @JsonKey(name: 'default') final bool isDefault,
    required final String tier,
    required final ModelCost cost,
  }) = _$ChatModelImpl;

  factory _ChatModel.fromJson(Map<String, dynamic> json) =
      _$ChatModelImpl.fromJson;

  @override
  String get id;
  @override
  String get name;
  @override
  String get privacy;
  @override
  int get context;
  @override
  @JsonKey(name: 'default')
  bool get isDefault;
  @override
  String get tier;
  @override
  ModelCost get cost;

  /// Create a copy of ChatModel
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$ChatModelImplCopyWith<_$ChatModelImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
