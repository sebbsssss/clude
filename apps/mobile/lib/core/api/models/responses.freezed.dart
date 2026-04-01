// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'responses.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
  'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models',
);

AutoRegisterResponse _$AutoRegisterResponseFromJson(Map<String, dynamic> json) {
  return _AutoRegisterResponse.fromJson(json);
}

/// @nodoc
mixin _$AutoRegisterResponse {
  @JsonKey(name: 'api_key')
  String get apiKey => throw _privateConstructorUsedError;
  @JsonKey(name: 'agent_id')
  String get agentId => throw _privateConstructorUsedError;
  bool get created => throw _privateConstructorUsedError;

  /// Serializes this AutoRegisterResponse to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of AutoRegisterResponse
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $AutoRegisterResponseCopyWith<AutoRegisterResponse> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $AutoRegisterResponseCopyWith<$Res> {
  factory $AutoRegisterResponseCopyWith(
    AutoRegisterResponse value,
    $Res Function(AutoRegisterResponse) then,
  ) = _$AutoRegisterResponseCopyWithImpl<$Res, AutoRegisterResponse>;
  @useResult
  $Res call({
    @JsonKey(name: 'api_key') String apiKey,
    @JsonKey(name: 'agent_id') String agentId,
    bool created,
  });
}

/// @nodoc
class _$AutoRegisterResponseCopyWithImpl<
  $Res,
  $Val extends AutoRegisterResponse
>
    implements $AutoRegisterResponseCopyWith<$Res> {
  _$AutoRegisterResponseCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of AutoRegisterResponse
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? apiKey = null,
    Object? agentId = null,
    Object? created = null,
  }) {
    return _then(
      _value.copyWith(
            apiKey: null == apiKey
                ? _value.apiKey
                : apiKey // ignore: cast_nullable_to_non_nullable
                      as String,
            agentId: null == agentId
                ? _value.agentId
                : agentId // ignore: cast_nullable_to_non_nullable
                      as String,
            created: null == created
                ? _value.created
                : created // ignore: cast_nullable_to_non_nullable
                      as bool,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$AutoRegisterResponseImplCopyWith<$Res>
    implements $AutoRegisterResponseCopyWith<$Res> {
  factory _$$AutoRegisterResponseImplCopyWith(
    _$AutoRegisterResponseImpl value,
    $Res Function(_$AutoRegisterResponseImpl) then,
  ) = __$$AutoRegisterResponseImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    @JsonKey(name: 'api_key') String apiKey,
    @JsonKey(name: 'agent_id') String agentId,
    bool created,
  });
}

/// @nodoc
class __$$AutoRegisterResponseImplCopyWithImpl<$Res>
    extends _$AutoRegisterResponseCopyWithImpl<$Res, _$AutoRegisterResponseImpl>
    implements _$$AutoRegisterResponseImplCopyWith<$Res> {
  __$$AutoRegisterResponseImplCopyWithImpl(
    _$AutoRegisterResponseImpl _value,
    $Res Function(_$AutoRegisterResponseImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of AutoRegisterResponse
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? apiKey = null,
    Object? agentId = null,
    Object? created = null,
  }) {
    return _then(
      _$AutoRegisterResponseImpl(
        apiKey: null == apiKey
            ? _value.apiKey
            : apiKey // ignore: cast_nullable_to_non_nullable
                  as String,
        agentId: null == agentId
            ? _value.agentId
            : agentId // ignore: cast_nullable_to_non_nullable
                  as String,
        created: null == created
            ? _value.created
            : created // ignore: cast_nullable_to_non_nullable
                  as bool,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$AutoRegisterResponseImpl implements _AutoRegisterResponse {
  const _$AutoRegisterResponseImpl({
    @JsonKey(name: 'api_key') required this.apiKey,
    @JsonKey(name: 'agent_id') required this.agentId,
    required this.created,
  });

  factory _$AutoRegisterResponseImpl.fromJson(Map<String, dynamic> json) =>
      _$$AutoRegisterResponseImplFromJson(json);

  @override
  @JsonKey(name: 'api_key')
  final String apiKey;
  @override
  @JsonKey(name: 'agent_id')
  final String agentId;
  @override
  final bool created;

  @override
  String toString() {
    return 'AutoRegisterResponse(apiKey: $apiKey, agentId: $agentId, created: $created)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$AutoRegisterResponseImpl &&
            (identical(other.apiKey, apiKey) || other.apiKey == apiKey) &&
            (identical(other.agentId, agentId) || other.agentId == agentId) &&
            (identical(other.created, created) || other.created == created));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(runtimeType, apiKey, agentId, created);

  /// Create a copy of AutoRegisterResponse
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$AutoRegisterResponseImplCopyWith<_$AutoRegisterResponseImpl>
  get copyWith =>
      __$$AutoRegisterResponseImplCopyWithImpl<_$AutoRegisterResponseImpl>(
        this,
        _$identity,
      );

  @override
  Map<String, dynamic> toJson() {
    return _$$AutoRegisterResponseImplToJson(this);
  }
}

abstract class _AutoRegisterResponse implements AutoRegisterResponse {
  const factory _AutoRegisterResponse({
    @JsonKey(name: 'api_key') required final String apiKey,
    @JsonKey(name: 'agent_id') required final String agentId,
    required final bool created,
  }) = _$AutoRegisterResponseImpl;

  factory _AutoRegisterResponse.fromJson(Map<String, dynamic> json) =
      _$AutoRegisterResponseImpl.fromJson;

  @override
  @JsonKey(name: 'api_key')
  String get apiKey;
  @override
  @JsonKey(name: 'agent_id')
  String get agentId;
  @override
  bool get created;

  /// Create a copy of AutoRegisterResponse
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$AutoRegisterResponseImplCopyWith<_$AutoRegisterResponseImpl>
  get copyWith => throw _privateConstructorUsedError;
}

Balance _$BalanceFromJson(Map<String, dynamic> json) {
  return _Balance.fromJson(json);
}

/// @nodoc
mixin _$Balance {
  @JsonKey(name: 'balance_usdc')
  double get balanceUsdc => throw _privateConstructorUsedError;
  @JsonKey(name: 'wallet_address')
  String get walletAddress => throw _privateConstructorUsedError;
  bool? get promo => throw _privateConstructorUsedError;
  @JsonKey(name: 'promo_credit_usdc')
  double? get promoCreditUsdc => throw _privateConstructorUsedError;

  /// Serializes this Balance to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of Balance
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $BalanceCopyWith<Balance> get copyWith => throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $BalanceCopyWith<$Res> {
  factory $BalanceCopyWith(Balance value, $Res Function(Balance) then) =
      _$BalanceCopyWithImpl<$Res, Balance>;
  @useResult
  $Res call({
    @JsonKey(name: 'balance_usdc') double balanceUsdc,
    @JsonKey(name: 'wallet_address') String walletAddress,
    bool? promo,
    @JsonKey(name: 'promo_credit_usdc') double? promoCreditUsdc,
  });
}

/// @nodoc
class _$BalanceCopyWithImpl<$Res, $Val extends Balance>
    implements $BalanceCopyWith<$Res> {
  _$BalanceCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of Balance
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? balanceUsdc = null,
    Object? walletAddress = null,
    Object? promo = freezed,
    Object? promoCreditUsdc = freezed,
  }) {
    return _then(
      _value.copyWith(
            balanceUsdc: null == balanceUsdc
                ? _value.balanceUsdc
                : balanceUsdc // ignore: cast_nullable_to_non_nullable
                      as double,
            walletAddress: null == walletAddress
                ? _value.walletAddress
                : walletAddress // ignore: cast_nullable_to_non_nullable
                      as String,
            promo: freezed == promo
                ? _value.promo
                : promo // ignore: cast_nullable_to_non_nullable
                      as bool?,
            promoCreditUsdc: freezed == promoCreditUsdc
                ? _value.promoCreditUsdc
                : promoCreditUsdc // ignore: cast_nullable_to_non_nullable
                      as double?,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$BalanceImplCopyWith<$Res> implements $BalanceCopyWith<$Res> {
  factory _$$BalanceImplCopyWith(
    _$BalanceImpl value,
    $Res Function(_$BalanceImpl) then,
  ) = __$$BalanceImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    @JsonKey(name: 'balance_usdc') double balanceUsdc,
    @JsonKey(name: 'wallet_address') String walletAddress,
    bool? promo,
    @JsonKey(name: 'promo_credit_usdc') double? promoCreditUsdc,
  });
}

/// @nodoc
class __$$BalanceImplCopyWithImpl<$Res>
    extends _$BalanceCopyWithImpl<$Res, _$BalanceImpl>
    implements _$$BalanceImplCopyWith<$Res> {
  __$$BalanceImplCopyWithImpl(
    _$BalanceImpl _value,
    $Res Function(_$BalanceImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of Balance
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? balanceUsdc = null,
    Object? walletAddress = null,
    Object? promo = freezed,
    Object? promoCreditUsdc = freezed,
  }) {
    return _then(
      _$BalanceImpl(
        balanceUsdc: null == balanceUsdc
            ? _value.balanceUsdc
            : balanceUsdc // ignore: cast_nullable_to_non_nullable
                  as double,
        walletAddress: null == walletAddress
            ? _value.walletAddress
            : walletAddress // ignore: cast_nullable_to_non_nullable
                  as String,
        promo: freezed == promo
            ? _value.promo
            : promo // ignore: cast_nullable_to_non_nullable
                  as bool?,
        promoCreditUsdc: freezed == promoCreditUsdc
            ? _value.promoCreditUsdc
            : promoCreditUsdc // ignore: cast_nullable_to_non_nullable
                  as double?,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$BalanceImpl implements _Balance {
  const _$BalanceImpl({
    @JsonKey(name: 'balance_usdc') required this.balanceUsdc,
    @JsonKey(name: 'wallet_address') required this.walletAddress,
    this.promo,
    @JsonKey(name: 'promo_credit_usdc') this.promoCreditUsdc,
  });

  factory _$BalanceImpl.fromJson(Map<String, dynamic> json) =>
      _$$BalanceImplFromJson(json);

  @override
  @JsonKey(name: 'balance_usdc')
  final double balanceUsdc;
  @override
  @JsonKey(name: 'wallet_address')
  final String walletAddress;
  @override
  final bool? promo;
  @override
  @JsonKey(name: 'promo_credit_usdc')
  final double? promoCreditUsdc;

  @override
  String toString() {
    return 'Balance(balanceUsdc: $balanceUsdc, walletAddress: $walletAddress, promo: $promo, promoCreditUsdc: $promoCreditUsdc)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$BalanceImpl &&
            (identical(other.balanceUsdc, balanceUsdc) ||
                other.balanceUsdc == balanceUsdc) &&
            (identical(other.walletAddress, walletAddress) ||
                other.walletAddress == walletAddress) &&
            (identical(other.promo, promo) || other.promo == promo) &&
            (identical(other.promoCreditUsdc, promoCreditUsdc) ||
                other.promoCreditUsdc == promoCreditUsdc));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
    runtimeType,
    balanceUsdc,
    walletAddress,
    promo,
    promoCreditUsdc,
  );

  /// Create a copy of Balance
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$BalanceImplCopyWith<_$BalanceImpl> get copyWith =>
      __$$BalanceImplCopyWithImpl<_$BalanceImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$BalanceImplToJson(this);
  }
}

abstract class _Balance implements Balance {
  const factory _Balance({
    @JsonKey(name: 'balance_usdc') required final double balanceUsdc,
    @JsonKey(name: 'wallet_address') required final String walletAddress,
    final bool? promo,
    @JsonKey(name: 'promo_credit_usdc') final double? promoCreditUsdc,
  }) = _$BalanceImpl;

  factory _Balance.fromJson(Map<String, dynamic> json) = _$BalanceImpl.fromJson;

  @override
  @JsonKey(name: 'balance_usdc')
  double get balanceUsdc;
  @override
  @JsonKey(name: 'wallet_address')
  String get walletAddress;
  @override
  bool? get promo;
  @override
  @JsonKey(name: 'promo_credit_usdc')
  double? get promoCreditUsdc;

  /// Create a copy of Balance
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$BalanceImplCopyWith<_$BalanceImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

TopupIntent _$TopupIntentFromJson(Map<String, dynamic> json) {
  return _TopupIntent.fromJson(json);
}

/// @nodoc
mixin _$TopupIntent {
  String get id => throw _privateConstructorUsedError;
  @JsonKey(name: 'wallet_address')
  String get walletAddress => throw _privateConstructorUsedError;
  @JsonKey(name: 'amount_usdc')
  double get amountUsdc => throw _privateConstructorUsedError;
  String get chain => throw _privateConstructorUsedError;
  @JsonKey(name: 'dest_address')
  String get destAddress => throw _privateConstructorUsedError;

  /// Serializes this TopupIntent to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of TopupIntent
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $TopupIntentCopyWith<TopupIntent> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $TopupIntentCopyWith<$Res> {
  factory $TopupIntentCopyWith(
    TopupIntent value,
    $Res Function(TopupIntent) then,
  ) = _$TopupIntentCopyWithImpl<$Res, TopupIntent>;
  @useResult
  $Res call({
    String id,
    @JsonKey(name: 'wallet_address') String walletAddress,
    @JsonKey(name: 'amount_usdc') double amountUsdc,
    String chain,
    @JsonKey(name: 'dest_address') String destAddress,
  });
}

/// @nodoc
class _$TopupIntentCopyWithImpl<$Res, $Val extends TopupIntent>
    implements $TopupIntentCopyWith<$Res> {
  _$TopupIntentCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of TopupIntent
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? walletAddress = null,
    Object? amountUsdc = null,
    Object? chain = null,
    Object? destAddress = null,
  }) {
    return _then(
      _value.copyWith(
            id: null == id
                ? _value.id
                : id // ignore: cast_nullable_to_non_nullable
                      as String,
            walletAddress: null == walletAddress
                ? _value.walletAddress
                : walletAddress // ignore: cast_nullable_to_non_nullable
                      as String,
            amountUsdc: null == amountUsdc
                ? _value.amountUsdc
                : amountUsdc // ignore: cast_nullable_to_non_nullable
                      as double,
            chain: null == chain
                ? _value.chain
                : chain // ignore: cast_nullable_to_non_nullable
                      as String,
            destAddress: null == destAddress
                ? _value.destAddress
                : destAddress // ignore: cast_nullable_to_non_nullable
                      as String,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$TopupIntentImplCopyWith<$Res>
    implements $TopupIntentCopyWith<$Res> {
  factory _$$TopupIntentImplCopyWith(
    _$TopupIntentImpl value,
    $Res Function(_$TopupIntentImpl) then,
  ) = __$$TopupIntentImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    String id,
    @JsonKey(name: 'wallet_address') String walletAddress,
    @JsonKey(name: 'amount_usdc') double amountUsdc,
    String chain,
    @JsonKey(name: 'dest_address') String destAddress,
  });
}

/// @nodoc
class __$$TopupIntentImplCopyWithImpl<$Res>
    extends _$TopupIntentCopyWithImpl<$Res, _$TopupIntentImpl>
    implements _$$TopupIntentImplCopyWith<$Res> {
  __$$TopupIntentImplCopyWithImpl(
    _$TopupIntentImpl _value,
    $Res Function(_$TopupIntentImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of TopupIntent
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? walletAddress = null,
    Object? amountUsdc = null,
    Object? chain = null,
    Object? destAddress = null,
  }) {
    return _then(
      _$TopupIntentImpl(
        id: null == id
            ? _value.id
            : id // ignore: cast_nullable_to_non_nullable
                  as String,
        walletAddress: null == walletAddress
            ? _value.walletAddress
            : walletAddress // ignore: cast_nullable_to_non_nullable
                  as String,
        amountUsdc: null == amountUsdc
            ? _value.amountUsdc
            : amountUsdc // ignore: cast_nullable_to_non_nullable
                  as double,
        chain: null == chain
            ? _value.chain
            : chain // ignore: cast_nullable_to_non_nullable
                  as String,
        destAddress: null == destAddress
            ? _value.destAddress
            : destAddress // ignore: cast_nullable_to_non_nullable
                  as String,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$TopupIntentImpl implements _TopupIntent {
  const _$TopupIntentImpl({
    required this.id,
    @JsonKey(name: 'wallet_address') required this.walletAddress,
    @JsonKey(name: 'amount_usdc') required this.amountUsdc,
    required this.chain,
    @JsonKey(name: 'dest_address') required this.destAddress,
  });

  factory _$TopupIntentImpl.fromJson(Map<String, dynamic> json) =>
      _$$TopupIntentImplFromJson(json);

  @override
  final String id;
  @override
  @JsonKey(name: 'wallet_address')
  final String walletAddress;
  @override
  @JsonKey(name: 'amount_usdc')
  final double amountUsdc;
  @override
  final String chain;
  @override
  @JsonKey(name: 'dest_address')
  final String destAddress;

  @override
  String toString() {
    return 'TopupIntent(id: $id, walletAddress: $walletAddress, amountUsdc: $amountUsdc, chain: $chain, destAddress: $destAddress)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$TopupIntentImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.walletAddress, walletAddress) ||
                other.walletAddress == walletAddress) &&
            (identical(other.amountUsdc, amountUsdc) ||
                other.amountUsdc == amountUsdc) &&
            (identical(other.chain, chain) || other.chain == chain) &&
            (identical(other.destAddress, destAddress) ||
                other.destAddress == destAddress));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
    runtimeType,
    id,
    walletAddress,
    amountUsdc,
    chain,
    destAddress,
  );

  /// Create a copy of TopupIntent
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$TopupIntentImplCopyWith<_$TopupIntentImpl> get copyWith =>
      __$$TopupIntentImplCopyWithImpl<_$TopupIntentImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$TopupIntentImplToJson(this);
  }
}

abstract class _TopupIntent implements TopupIntent {
  const factory _TopupIntent({
    required final String id,
    @JsonKey(name: 'wallet_address') required final String walletAddress,
    @JsonKey(name: 'amount_usdc') required final double amountUsdc,
    required final String chain,
    @JsonKey(name: 'dest_address') required final String destAddress,
  }) = _$TopupIntentImpl;

  factory _TopupIntent.fromJson(Map<String, dynamic> json) =
      _$TopupIntentImpl.fromJson;

  @override
  String get id;
  @override
  @JsonKey(name: 'wallet_address')
  String get walletAddress;
  @override
  @JsonKey(name: 'amount_usdc')
  double get amountUsdc;
  @override
  String get chain;
  @override
  @JsonKey(name: 'dest_address')
  String get destAddress;

  /// Create a copy of TopupIntent
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$TopupIntentImplCopyWith<_$TopupIntentImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

TopupConfirmation _$TopupConfirmationFromJson(Map<String, dynamic> json) {
  return _TopupConfirmation.fromJson(json);
}

/// @nodoc
mixin _$TopupConfirmation {
  String get status => throw _privateConstructorUsedError;
  @JsonKey(name: 'balance_usdc')
  double get balanceUsdc => throw _privateConstructorUsedError;

  /// Serializes this TopupConfirmation to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of TopupConfirmation
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $TopupConfirmationCopyWith<TopupConfirmation> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $TopupConfirmationCopyWith<$Res> {
  factory $TopupConfirmationCopyWith(
    TopupConfirmation value,
    $Res Function(TopupConfirmation) then,
  ) = _$TopupConfirmationCopyWithImpl<$Res, TopupConfirmation>;
  @useResult
  $Res call({String status, @JsonKey(name: 'balance_usdc') double balanceUsdc});
}

/// @nodoc
class _$TopupConfirmationCopyWithImpl<$Res, $Val extends TopupConfirmation>
    implements $TopupConfirmationCopyWith<$Res> {
  _$TopupConfirmationCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of TopupConfirmation
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({Object? status = null, Object? balanceUsdc = null}) {
    return _then(
      _value.copyWith(
            status: null == status
                ? _value.status
                : status // ignore: cast_nullable_to_non_nullable
                      as String,
            balanceUsdc: null == balanceUsdc
                ? _value.balanceUsdc
                : balanceUsdc // ignore: cast_nullable_to_non_nullable
                      as double,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$TopupConfirmationImplCopyWith<$Res>
    implements $TopupConfirmationCopyWith<$Res> {
  factory _$$TopupConfirmationImplCopyWith(
    _$TopupConfirmationImpl value,
    $Res Function(_$TopupConfirmationImpl) then,
  ) = __$$TopupConfirmationImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({String status, @JsonKey(name: 'balance_usdc') double balanceUsdc});
}

/// @nodoc
class __$$TopupConfirmationImplCopyWithImpl<$Res>
    extends _$TopupConfirmationCopyWithImpl<$Res, _$TopupConfirmationImpl>
    implements _$$TopupConfirmationImplCopyWith<$Res> {
  __$$TopupConfirmationImplCopyWithImpl(
    _$TopupConfirmationImpl _value,
    $Res Function(_$TopupConfirmationImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of TopupConfirmation
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({Object? status = null, Object? balanceUsdc = null}) {
    return _then(
      _$TopupConfirmationImpl(
        status: null == status
            ? _value.status
            : status // ignore: cast_nullable_to_non_nullable
                  as String,
        balanceUsdc: null == balanceUsdc
            ? _value.balanceUsdc
            : balanceUsdc // ignore: cast_nullable_to_non_nullable
                  as double,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$TopupConfirmationImpl implements _TopupConfirmation {
  const _$TopupConfirmationImpl({
    required this.status,
    @JsonKey(name: 'balance_usdc') required this.balanceUsdc,
  });

  factory _$TopupConfirmationImpl.fromJson(Map<String, dynamic> json) =>
      _$$TopupConfirmationImplFromJson(json);

  @override
  final String status;
  @override
  @JsonKey(name: 'balance_usdc')
  final double balanceUsdc;

  @override
  String toString() {
    return 'TopupConfirmation(status: $status, balanceUsdc: $balanceUsdc)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$TopupConfirmationImpl &&
            (identical(other.status, status) || other.status == status) &&
            (identical(other.balanceUsdc, balanceUsdc) ||
                other.balanceUsdc == balanceUsdc));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(runtimeType, status, balanceUsdc);

  /// Create a copy of TopupConfirmation
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$TopupConfirmationImplCopyWith<_$TopupConfirmationImpl> get copyWith =>
      __$$TopupConfirmationImplCopyWithImpl<_$TopupConfirmationImpl>(
        this,
        _$identity,
      );

  @override
  Map<String, dynamic> toJson() {
    return _$$TopupConfirmationImplToJson(this);
  }
}

abstract class _TopupConfirmation implements TopupConfirmation {
  const factory _TopupConfirmation({
    required final String status,
    @JsonKey(name: 'balance_usdc') required final double balanceUsdc,
  }) = _$TopupConfirmationImpl;

  factory _TopupConfirmation.fromJson(Map<String, dynamic> json) =
      _$TopupConfirmationImpl.fromJson;

  @override
  String get status;
  @override
  @JsonKey(name: 'balance_usdc')
  double get balanceUsdc;

  /// Create a copy of TopupConfirmation
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$TopupConfirmationImplCopyWith<_$TopupConfirmationImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

TopupStatus _$TopupStatusFromJson(Map<String, dynamic> json) {
  return _TopupStatus.fromJson(json);
}

/// @nodoc
mixin _$TopupStatus {
  String get status => throw _privateConstructorUsedError;
  @JsonKey(name: 'amount_usdc')
  double? get amountUsdc => throw _privateConstructorUsedError;
  @JsonKey(name: 'tx_hash')
  String? get txHash => throw _privateConstructorUsedError;
  @JsonKey(name: 'balance_usdc')
  double? get balanceUsdc => throw _privateConstructorUsedError;

  /// Serializes this TopupStatus to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of TopupStatus
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $TopupStatusCopyWith<TopupStatus> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $TopupStatusCopyWith<$Res> {
  factory $TopupStatusCopyWith(
    TopupStatus value,
    $Res Function(TopupStatus) then,
  ) = _$TopupStatusCopyWithImpl<$Res, TopupStatus>;
  @useResult
  $Res call({
    String status,
    @JsonKey(name: 'amount_usdc') double? amountUsdc,
    @JsonKey(name: 'tx_hash') String? txHash,
    @JsonKey(name: 'balance_usdc') double? balanceUsdc,
  });
}

/// @nodoc
class _$TopupStatusCopyWithImpl<$Res, $Val extends TopupStatus>
    implements $TopupStatusCopyWith<$Res> {
  _$TopupStatusCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of TopupStatus
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? status = null,
    Object? amountUsdc = freezed,
    Object? txHash = freezed,
    Object? balanceUsdc = freezed,
  }) {
    return _then(
      _value.copyWith(
            status: null == status
                ? _value.status
                : status // ignore: cast_nullable_to_non_nullable
                      as String,
            amountUsdc: freezed == amountUsdc
                ? _value.amountUsdc
                : amountUsdc // ignore: cast_nullable_to_non_nullable
                      as double?,
            txHash: freezed == txHash
                ? _value.txHash
                : txHash // ignore: cast_nullable_to_non_nullable
                      as String?,
            balanceUsdc: freezed == balanceUsdc
                ? _value.balanceUsdc
                : balanceUsdc // ignore: cast_nullable_to_non_nullable
                      as double?,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$TopupStatusImplCopyWith<$Res>
    implements $TopupStatusCopyWith<$Res> {
  factory _$$TopupStatusImplCopyWith(
    _$TopupStatusImpl value,
    $Res Function(_$TopupStatusImpl) then,
  ) = __$$TopupStatusImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    String status,
    @JsonKey(name: 'amount_usdc') double? amountUsdc,
    @JsonKey(name: 'tx_hash') String? txHash,
    @JsonKey(name: 'balance_usdc') double? balanceUsdc,
  });
}

/// @nodoc
class __$$TopupStatusImplCopyWithImpl<$Res>
    extends _$TopupStatusCopyWithImpl<$Res, _$TopupStatusImpl>
    implements _$$TopupStatusImplCopyWith<$Res> {
  __$$TopupStatusImplCopyWithImpl(
    _$TopupStatusImpl _value,
    $Res Function(_$TopupStatusImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of TopupStatus
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? status = null,
    Object? amountUsdc = freezed,
    Object? txHash = freezed,
    Object? balanceUsdc = freezed,
  }) {
    return _then(
      _$TopupStatusImpl(
        status: null == status
            ? _value.status
            : status // ignore: cast_nullable_to_non_nullable
                  as String,
        amountUsdc: freezed == amountUsdc
            ? _value.amountUsdc
            : amountUsdc // ignore: cast_nullable_to_non_nullable
                  as double?,
        txHash: freezed == txHash
            ? _value.txHash
            : txHash // ignore: cast_nullable_to_non_nullable
                  as String?,
        balanceUsdc: freezed == balanceUsdc
            ? _value.balanceUsdc
            : balanceUsdc // ignore: cast_nullable_to_non_nullable
                  as double?,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$TopupStatusImpl implements _TopupStatus {
  const _$TopupStatusImpl({
    required this.status,
    @JsonKey(name: 'amount_usdc') this.amountUsdc,
    @JsonKey(name: 'tx_hash') this.txHash,
    @JsonKey(name: 'balance_usdc') this.balanceUsdc,
  });

  factory _$TopupStatusImpl.fromJson(Map<String, dynamic> json) =>
      _$$TopupStatusImplFromJson(json);

  @override
  final String status;
  @override
  @JsonKey(name: 'amount_usdc')
  final double? amountUsdc;
  @override
  @JsonKey(name: 'tx_hash')
  final String? txHash;
  @override
  @JsonKey(name: 'balance_usdc')
  final double? balanceUsdc;

  @override
  String toString() {
    return 'TopupStatus(status: $status, amountUsdc: $amountUsdc, txHash: $txHash, balanceUsdc: $balanceUsdc)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$TopupStatusImpl &&
            (identical(other.status, status) || other.status == status) &&
            (identical(other.amountUsdc, amountUsdc) ||
                other.amountUsdc == amountUsdc) &&
            (identical(other.txHash, txHash) || other.txHash == txHash) &&
            (identical(other.balanceUsdc, balanceUsdc) ||
                other.balanceUsdc == balanceUsdc));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode =>
      Object.hash(runtimeType, status, amountUsdc, txHash, balanceUsdc);

  /// Create a copy of TopupStatus
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$TopupStatusImplCopyWith<_$TopupStatusImpl> get copyWith =>
      __$$TopupStatusImplCopyWithImpl<_$TopupStatusImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$TopupStatusImplToJson(this);
  }
}

abstract class _TopupStatus implements TopupStatus {
  const factory _TopupStatus({
    required final String status,
    @JsonKey(name: 'amount_usdc') final double? amountUsdc,
    @JsonKey(name: 'tx_hash') final String? txHash,
    @JsonKey(name: 'balance_usdc') final double? balanceUsdc,
  }) = _$TopupStatusImpl;

  factory _TopupStatus.fromJson(Map<String, dynamic> json) =
      _$TopupStatusImpl.fromJson;

  @override
  String get status;
  @override
  @JsonKey(name: 'amount_usdc')
  double? get amountUsdc;
  @override
  @JsonKey(name: 'tx_hash')
  String? get txHash;
  @override
  @JsonKey(name: 'balance_usdc')
  double? get balanceUsdc;

  /// Create a copy of TopupStatus
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$TopupStatusImplCopyWith<_$TopupStatusImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

ImportResult _$ImportResultFromJson(Map<String, dynamic> json) {
  return _ImportResult.fromJson(json);
}

/// @nodoc
mixin _$ImportResult {
  int get imported => throw _privateConstructorUsedError;

  /// Serializes this ImportResult to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of ImportResult
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $ImportResultCopyWith<ImportResult> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $ImportResultCopyWith<$Res> {
  factory $ImportResultCopyWith(
    ImportResult value,
    $Res Function(ImportResult) then,
  ) = _$ImportResultCopyWithImpl<$Res, ImportResult>;
  @useResult
  $Res call({int imported});
}

/// @nodoc
class _$ImportResultCopyWithImpl<$Res, $Val extends ImportResult>
    implements $ImportResultCopyWith<$Res> {
  _$ImportResultCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of ImportResult
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({Object? imported = null}) {
    return _then(
      _value.copyWith(
            imported: null == imported
                ? _value.imported
                : imported // ignore: cast_nullable_to_non_nullable
                      as int,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$ImportResultImplCopyWith<$Res>
    implements $ImportResultCopyWith<$Res> {
  factory _$$ImportResultImplCopyWith(
    _$ImportResultImpl value,
    $Res Function(_$ImportResultImpl) then,
  ) = __$$ImportResultImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({int imported});
}

/// @nodoc
class __$$ImportResultImplCopyWithImpl<$Res>
    extends _$ImportResultCopyWithImpl<$Res, _$ImportResultImpl>
    implements _$$ImportResultImplCopyWith<$Res> {
  __$$ImportResultImplCopyWithImpl(
    _$ImportResultImpl _value,
    $Res Function(_$ImportResultImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of ImportResult
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({Object? imported = null}) {
    return _then(
      _$ImportResultImpl(
        imported: null == imported
            ? _value.imported
            : imported // ignore: cast_nullable_to_non_nullable
                  as int,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$ImportResultImpl implements _ImportResult {
  const _$ImportResultImpl({required this.imported});

  factory _$ImportResultImpl.fromJson(Map<String, dynamic> json) =>
      _$$ImportResultImplFromJson(json);

  @override
  final int imported;

  @override
  String toString() {
    return 'ImportResult(imported: $imported)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$ImportResultImpl &&
            (identical(other.imported, imported) ||
                other.imported == imported));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(runtimeType, imported);

  /// Create a copy of ImportResult
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$ImportResultImplCopyWith<_$ImportResultImpl> get copyWith =>
      __$$ImportResultImplCopyWithImpl<_$ImportResultImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$ImportResultImplToJson(this);
  }
}

abstract class _ImportResult implements ImportResult {
  const factory _ImportResult({required final int imported}) =
      _$ImportResultImpl;

  factory _ImportResult.fromJson(Map<String, dynamic> json) =
      _$ImportResultImpl.fromJson;

  @override
  int get imported;

  /// Create a copy of ImportResult
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$ImportResultImplCopyWith<_$ImportResultImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

MessageReceipt _$MessageReceiptFromJson(Map<String, dynamic> json) {
  return _MessageReceipt.fromJson(json);
}

/// @nodoc
mixin _$MessageReceipt {
  @JsonKey(name: 'cost_usdc')
  double get costUsdc => throw _privateConstructorUsedError;
  @JsonKey(name: 'equivalent_direct_cost')
  double get equivalentDirectCost => throw _privateConstructorUsedError;
  @JsonKey(name: 'savings_pct')
  double get savingsPct => throw _privateConstructorUsedError;
  @JsonKey(name: 'remaining_balance')
  double? get remainingBalance => throw _privateConstructorUsedError;

  /// Serializes this MessageReceipt to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of MessageReceipt
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $MessageReceiptCopyWith<MessageReceipt> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $MessageReceiptCopyWith<$Res> {
  factory $MessageReceiptCopyWith(
    MessageReceipt value,
    $Res Function(MessageReceipt) then,
  ) = _$MessageReceiptCopyWithImpl<$Res, MessageReceipt>;
  @useResult
  $Res call({
    @JsonKey(name: 'cost_usdc') double costUsdc,
    @JsonKey(name: 'equivalent_direct_cost') double equivalentDirectCost,
    @JsonKey(name: 'savings_pct') double savingsPct,
    @JsonKey(name: 'remaining_balance') double? remainingBalance,
  });
}

/// @nodoc
class _$MessageReceiptCopyWithImpl<$Res, $Val extends MessageReceipt>
    implements $MessageReceiptCopyWith<$Res> {
  _$MessageReceiptCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of MessageReceipt
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? costUsdc = null,
    Object? equivalentDirectCost = null,
    Object? savingsPct = null,
    Object? remainingBalance = freezed,
  }) {
    return _then(
      _value.copyWith(
            costUsdc: null == costUsdc
                ? _value.costUsdc
                : costUsdc // ignore: cast_nullable_to_non_nullable
                      as double,
            equivalentDirectCost: null == equivalentDirectCost
                ? _value.equivalentDirectCost
                : equivalentDirectCost // ignore: cast_nullable_to_non_nullable
                      as double,
            savingsPct: null == savingsPct
                ? _value.savingsPct
                : savingsPct // ignore: cast_nullable_to_non_nullable
                      as double,
            remainingBalance: freezed == remainingBalance
                ? _value.remainingBalance
                : remainingBalance // ignore: cast_nullable_to_non_nullable
                      as double?,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$MessageReceiptImplCopyWith<$Res>
    implements $MessageReceiptCopyWith<$Res> {
  factory _$$MessageReceiptImplCopyWith(
    _$MessageReceiptImpl value,
    $Res Function(_$MessageReceiptImpl) then,
  ) = __$$MessageReceiptImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    @JsonKey(name: 'cost_usdc') double costUsdc,
    @JsonKey(name: 'equivalent_direct_cost') double equivalentDirectCost,
    @JsonKey(name: 'savings_pct') double savingsPct,
    @JsonKey(name: 'remaining_balance') double? remainingBalance,
  });
}

/// @nodoc
class __$$MessageReceiptImplCopyWithImpl<$Res>
    extends _$MessageReceiptCopyWithImpl<$Res, _$MessageReceiptImpl>
    implements _$$MessageReceiptImplCopyWith<$Res> {
  __$$MessageReceiptImplCopyWithImpl(
    _$MessageReceiptImpl _value,
    $Res Function(_$MessageReceiptImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of MessageReceipt
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? costUsdc = null,
    Object? equivalentDirectCost = null,
    Object? savingsPct = null,
    Object? remainingBalance = freezed,
  }) {
    return _then(
      _$MessageReceiptImpl(
        costUsdc: null == costUsdc
            ? _value.costUsdc
            : costUsdc // ignore: cast_nullable_to_non_nullable
                  as double,
        equivalentDirectCost: null == equivalentDirectCost
            ? _value.equivalentDirectCost
            : equivalentDirectCost // ignore: cast_nullable_to_non_nullable
                  as double,
        savingsPct: null == savingsPct
            ? _value.savingsPct
            : savingsPct // ignore: cast_nullable_to_non_nullable
                  as double,
        remainingBalance: freezed == remainingBalance
            ? _value.remainingBalance
            : remainingBalance // ignore: cast_nullable_to_non_nullable
                  as double?,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$MessageReceiptImpl implements _MessageReceipt {
  const _$MessageReceiptImpl({
    @JsonKey(name: 'cost_usdc') required this.costUsdc,
    @JsonKey(name: 'equivalent_direct_cost') required this.equivalentDirectCost,
    @JsonKey(name: 'savings_pct') required this.savingsPct,
    @JsonKey(name: 'remaining_balance') this.remainingBalance,
  });

  factory _$MessageReceiptImpl.fromJson(Map<String, dynamic> json) =>
      _$$MessageReceiptImplFromJson(json);

  @override
  @JsonKey(name: 'cost_usdc')
  final double costUsdc;
  @override
  @JsonKey(name: 'equivalent_direct_cost')
  final double equivalentDirectCost;
  @override
  @JsonKey(name: 'savings_pct')
  final double savingsPct;
  @override
  @JsonKey(name: 'remaining_balance')
  final double? remainingBalance;

  @override
  String toString() {
    return 'MessageReceipt(costUsdc: $costUsdc, equivalentDirectCost: $equivalentDirectCost, savingsPct: $savingsPct, remainingBalance: $remainingBalance)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$MessageReceiptImpl &&
            (identical(other.costUsdc, costUsdc) ||
                other.costUsdc == costUsdc) &&
            (identical(other.equivalentDirectCost, equivalentDirectCost) ||
                other.equivalentDirectCost == equivalentDirectCost) &&
            (identical(other.savingsPct, savingsPct) ||
                other.savingsPct == savingsPct) &&
            (identical(other.remainingBalance, remainingBalance) ||
                other.remainingBalance == remainingBalance));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
    runtimeType,
    costUsdc,
    equivalentDirectCost,
    savingsPct,
    remainingBalance,
  );

  /// Create a copy of MessageReceipt
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$MessageReceiptImplCopyWith<_$MessageReceiptImpl> get copyWith =>
      __$$MessageReceiptImplCopyWithImpl<_$MessageReceiptImpl>(
        this,
        _$identity,
      );

  @override
  Map<String, dynamic> toJson() {
    return _$$MessageReceiptImplToJson(this);
  }
}

abstract class _MessageReceipt implements MessageReceipt {
  const factory _MessageReceipt({
    @JsonKey(name: 'cost_usdc') required final double costUsdc,
    @JsonKey(name: 'equivalent_direct_cost')
    required final double equivalentDirectCost,
    @JsonKey(name: 'savings_pct') required final double savingsPct,
    @JsonKey(name: 'remaining_balance') final double? remainingBalance,
  }) = _$MessageReceiptImpl;

  factory _MessageReceipt.fromJson(Map<String, dynamic> json) =
      _$MessageReceiptImpl.fromJson;

  @override
  @JsonKey(name: 'cost_usdc')
  double get costUsdc;
  @override
  @JsonKey(name: 'equivalent_direct_cost')
  double get equivalentDirectCost;
  @override
  @JsonKey(name: 'savings_pct')
  double get savingsPct;
  @override
  @JsonKey(name: 'remaining_balance')
  double? get remainingBalance;

  /// Create a copy of MessageReceipt
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$MessageReceiptImplCopyWith<_$MessageReceiptImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

StreamDoneData _$StreamDoneDataFromJson(Map<String, dynamic> json) {
  return _StreamDoneData.fromJson(json);
}

/// @nodoc
mixin _$StreamDoneData {
  bool get done => throw _privateConstructorUsedError;
  @JsonKey(name: 'message_id')
  String? get messageId => throw _privateConstructorUsedError;
  String? get model => throw _privateConstructorUsedError;
  @JsonKey(name: 'memories_used')
  int? get memoriesUsed => throw _privateConstructorUsedError;
  @JsonKey(name: 'memory_ids')
  List<int>? get memoryIds => throw _privateConstructorUsedError;
  Map<String, dynamic>? get cost => throw _privateConstructorUsedError;
  Map<String, dynamic>? get tokens => throw _privateConstructorUsedError;
  MessageReceipt? get receipt => throw _privateConstructorUsedError;

  /// Serializes this StreamDoneData to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of StreamDoneData
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $StreamDoneDataCopyWith<StreamDoneData> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $StreamDoneDataCopyWith<$Res> {
  factory $StreamDoneDataCopyWith(
    StreamDoneData value,
    $Res Function(StreamDoneData) then,
  ) = _$StreamDoneDataCopyWithImpl<$Res, StreamDoneData>;
  @useResult
  $Res call({
    bool done,
    @JsonKey(name: 'message_id') String? messageId,
    String? model,
    @JsonKey(name: 'memories_used') int? memoriesUsed,
    @JsonKey(name: 'memory_ids') List<int>? memoryIds,
    Map<String, dynamic>? cost,
    Map<String, dynamic>? tokens,
    MessageReceipt? receipt,
  });

  $MessageReceiptCopyWith<$Res>? get receipt;
}

/// @nodoc
class _$StreamDoneDataCopyWithImpl<$Res, $Val extends StreamDoneData>
    implements $StreamDoneDataCopyWith<$Res> {
  _$StreamDoneDataCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of StreamDoneData
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? done = null,
    Object? messageId = freezed,
    Object? model = freezed,
    Object? memoriesUsed = freezed,
    Object? memoryIds = freezed,
    Object? cost = freezed,
    Object? tokens = freezed,
    Object? receipt = freezed,
  }) {
    return _then(
      _value.copyWith(
            done: null == done
                ? _value.done
                : done // ignore: cast_nullable_to_non_nullable
                      as bool,
            messageId: freezed == messageId
                ? _value.messageId
                : messageId // ignore: cast_nullable_to_non_nullable
                      as String?,
            model: freezed == model
                ? _value.model
                : model // ignore: cast_nullable_to_non_nullable
                      as String?,
            memoriesUsed: freezed == memoriesUsed
                ? _value.memoriesUsed
                : memoriesUsed // ignore: cast_nullable_to_non_nullable
                      as int?,
            memoryIds: freezed == memoryIds
                ? _value.memoryIds
                : memoryIds // ignore: cast_nullable_to_non_nullable
                      as List<int>?,
            cost: freezed == cost
                ? _value.cost
                : cost // ignore: cast_nullable_to_non_nullable
                      as Map<String, dynamic>?,
            tokens: freezed == tokens
                ? _value.tokens
                : tokens // ignore: cast_nullable_to_non_nullable
                      as Map<String, dynamic>?,
            receipt: freezed == receipt
                ? _value.receipt
                : receipt // ignore: cast_nullable_to_non_nullable
                      as MessageReceipt?,
          )
          as $Val,
    );
  }

  /// Create a copy of StreamDoneData
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $MessageReceiptCopyWith<$Res>? get receipt {
    if (_value.receipt == null) {
      return null;
    }

    return $MessageReceiptCopyWith<$Res>(_value.receipt!, (value) {
      return _then(_value.copyWith(receipt: value) as $Val);
    });
  }
}

/// @nodoc
abstract class _$$StreamDoneDataImplCopyWith<$Res>
    implements $StreamDoneDataCopyWith<$Res> {
  factory _$$StreamDoneDataImplCopyWith(
    _$StreamDoneDataImpl value,
    $Res Function(_$StreamDoneDataImpl) then,
  ) = __$$StreamDoneDataImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    bool done,
    @JsonKey(name: 'message_id') String? messageId,
    String? model,
    @JsonKey(name: 'memories_used') int? memoriesUsed,
    @JsonKey(name: 'memory_ids') List<int>? memoryIds,
    Map<String, dynamic>? cost,
    Map<String, dynamic>? tokens,
    MessageReceipt? receipt,
  });

  @override
  $MessageReceiptCopyWith<$Res>? get receipt;
}

/// @nodoc
class __$$StreamDoneDataImplCopyWithImpl<$Res>
    extends _$StreamDoneDataCopyWithImpl<$Res, _$StreamDoneDataImpl>
    implements _$$StreamDoneDataImplCopyWith<$Res> {
  __$$StreamDoneDataImplCopyWithImpl(
    _$StreamDoneDataImpl _value,
    $Res Function(_$StreamDoneDataImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of StreamDoneData
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? done = null,
    Object? messageId = freezed,
    Object? model = freezed,
    Object? memoriesUsed = freezed,
    Object? memoryIds = freezed,
    Object? cost = freezed,
    Object? tokens = freezed,
    Object? receipt = freezed,
  }) {
    return _then(
      _$StreamDoneDataImpl(
        done: null == done
            ? _value.done
            : done // ignore: cast_nullable_to_non_nullable
                  as bool,
        messageId: freezed == messageId
            ? _value.messageId
            : messageId // ignore: cast_nullable_to_non_nullable
                  as String?,
        model: freezed == model
            ? _value.model
            : model // ignore: cast_nullable_to_non_nullable
                  as String?,
        memoriesUsed: freezed == memoriesUsed
            ? _value.memoriesUsed
            : memoriesUsed // ignore: cast_nullable_to_non_nullable
                  as int?,
        memoryIds: freezed == memoryIds
            ? _value._memoryIds
            : memoryIds // ignore: cast_nullable_to_non_nullable
                  as List<int>?,
        cost: freezed == cost
            ? _value._cost
            : cost // ignore: cast_nullable_to_non_nullable
                  as Map<String, dynamic>?,
        tokens: freezed == tokens
            ? _value._tokens
            : tokens // ignore: cast_nullable_to_non_nullable
                  as Map<String, dynamic>?,
        receipt: freezed == receipt
            ? _value.receipt
            : receipt // ignore: cast_nullable_to_non_nullable
                  as MessageReceipt?,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$StreamDoneDataImpl implements _StreamDoneData {
  const _$StreamDoneDataImpl({
    required this.done,
    @JsonKey(name: 'message_id') this.messageId,
    this.model,
    @JsonKey(name: 'memories_used') this.memoriesUsed,
    @JsonKey(name: 'memory_ids') final List<int>? memoryIds,
    final Map<String, dynamic>? cost,
    final Map<String, dynamic>? tokens,
    this.receipt,
  }) : _memoryIds = memoryIds,
       _cost = cost,
       _tokens = tokens;

  factory _$StreamDoneDataImpl.fromJson(Map<String, dynamic> json) =>
      _$$StreamDoneDataImplFromJson(json);

  @override
  final bool done;
  @override
  @JsonKey(name: 'message_id')
  final String? messageId;
  @override
  final String? model;
  @override
  @JsonKey(name: 'memories_used')
  final int? memoriesUsed;
  final List<int>? _memoryIds;
  @override
  @JsonKey(name: 'memory_ids')
  List<int>? get memoryIds {
    final value = _memoryIds;
    if (value == null) return null;
    if (_memoryIds is EqualUnmodifiableListView) return _memoryIds;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(value);
  }

  final Map<String, dynamic>? _cost;
  @override
  Map<String, dynamic>? get cost {
    final value = _cost;
    if (value == null) return null;
    if (_cost is EqualUnmodifiableMapView) return _cost;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableMapView(value);
  }

  final Map<String, dynamic>? _tokens;
  @override
  Map<String, dynamic>? get tokens {
    final value = _tokens;
    if (value == null) return null;
    if (_tokens is EqualUnmodifiableMapView) return _tokens;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableMapView(value);
  }

  @override
  final MessageReceipt? receipt;

  @override
  String toString() {
    return 'StreamDoneData(done: $done, messageId: $messageId, model: $model, memoriesUsed: $memoriesUsed, memoryIds: $memoryIds, cost: $cost, tokens: $tokens, receipt: $receipt)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$StreamDoneDataImpl &&
            (identical(other.done, done) || other.done == done) &&
            (identical(other.messageId, messageId) ||
                other.messageId == messageId) &&
            (identical(other.model, model) || other.model == model) &&
            (identical(other.memoriesUsed, memoriesUsed) ||
                other.memoriesUsed == memoriesUsed) &&
            const DeepCollectionEquality().equals(
              other._memoryIds,
              _memoryIds,
            ) &&
            const DeepCollectionEquality().equals(other._cost, _cost) &&
            const DeepCollectionEquality().equals(other._tokens, _tokens) &&
            (identical(other.receipt, receipt) || other.receipt == receipt));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
    runtimeType,
    done,
    messageId,
    model,
    memoriesUsed,
    const DeepCollectionEquality().hash(_memoryIds),
    const DeepCollectionEquality().hash(_cost),
    const DeepCollectionEquality().hash(_tokens),
    receipt,
  );

  /// Create a copy of StreamDoneData
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$StreamDoneDataImplCopyWith<_$StreamDoneDataImpl> get copyWith =>
      __$$StreamDoneDataImplCopyWithImpl<_$StreamDoneDataImpl>(
        this,
        _$identity,
      );

  @override
  Map<String, dynamic> toJson() {
    return _$$StreamDoneDataImplToJson(this);
  }
}

abstract class _StreamDoneData implements StreamDoneData {
  const factory _StreamDoneData({
    required final bool done,
    @JsonKey(name: 'message_id') final String? messageId,
    final String? model,
    @JsonKey(name: 'memories_used') final int? memoriesUsed,
    @JsonKey(name: 'memory_ids') final List<int>? memoryIds,
    final Map<String, dynamic>? cost,
    final Map<String, dynamic>? tokens,
    final MessageReceipt? receipt,
  }) = _$StreamDoneDataImpl;

  factory _StreamDoneData.fromJson(Map<String, dynamic> json) =
      _$StreamDoneDataImpl.fromJson;

  @override
  bool get done;
  @override
  @JsonKey(name: 'message_id')
  String? get messageId;
  @override
  String? get model;
  @override
  @JsonKey(name: 'memories_used')
  int? get memoriesUsed;
  @override
  @JsonKey(name: 'memory_ids')
  List<int>? get memoryIds;
  @override
  Map<String, dynamic>? get cost;
  @override
  Map<String, dynamic>? get tokens;
  @override
  MessageReceipt? get receipt;

  /// Create a copy of StreamDoneData
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$StreamDoneDataImplCopyWith<_$StreamDoneDataImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
