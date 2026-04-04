// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'balance_state.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
  'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models',
);

/// @nodoc
mixin _$BalanceState {
  double? get balanceUsdc => throw _privateConstructorUsedError;
  bool get promoActive => throw _privateConstructorUsedError;
  double? get promoCreditUsdc => throw _privateConstructorUsedError;
  bool get isLoading => throw _privateConstructorUsedError;
  String? get error => throw _privateConstructorUsedError;
  double? get previousBalance => throw _privateConstructorUsedError;

  /// Create a copy of BalanceState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $BalanceStateCopyWith<BalanceState> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $BalanceStateCopyWith<$Res> {
  factory $BalanceStateCopyWith(
    BalanceState value,
    $Res Function(BalanceState) then,
  ) = _$BalanceStateCopyWithImpl<$Res, BalanceState>;
  @useResult
  $Res call({
    double? balanceUsdc,
    bool promoActive,
    double? promoCreditUsdc,
    bool isLoading,
    String? error,
    double? previousBalance,
  });
}

/// @nodoc
class _$BalanceStateCopyWithImpl<$Res, $Val extends BalanceState>
    implements $BalanceStateCopyWith<$Res> {
  _$BalanceStateCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of BalanceState
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? balanceUsdc = freezed,
    Object? promoActive = null,
    Object? promoCreditUsdc = freezed,
    Object? isLoading = null,
    Object? error = freezed,
    Object? previousBalance = freezed,
  }) {
    return _then(
      _value.copyWith(
            balanceUsdc: freezed == balanceUsdc
                ? _value.balanceUsdc
                : balanceUsdc // ignore: cast_nullable_to_non_nullable
                      as double?,
            promoActive: null == promoActive
                ? _value.promoActive
                : promoActive // ignore: cast_nullable_to_non_nullable
                      as bool,
            promoCreditUsdc: freezed == promoCreditUsdc
                ? _value.promoCreditUsdc
                : promoCreditUsdc // ignore: cast_nullable_to_non_nullable
                      as double?,
            isLoading: null == isLoading
                ? _value.isLoading
                : isLoading // ignore: cast_nullable_to_non_nullable
                      as bool,
            error: freezed == error
                ? _value.error
                : error // ignore: cast_nullable_to_non_nullable
                      as String?,
            previousBalance: freezed == previousBalance
                ? _value.previousBalance
                : previousBalance // ignore: cast_nullable_to_non_nullable
                      as double?,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$BalanceStateImplCopyWith<$Res>
    implements $BalanceStateCopyWith<$Res> {
  factory _$$BalanceStateImplCopyWith(
    _$BalanceStateImpl value,
    $Res Function(_$BalanceStateImpl) then,
  ) = __$$BalanceStateImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    double? balanceUsdc,
    bool promoActive,
    double? promoCreditUsdc,
    bool isLoading,
    String? error,
    double? previousBalance,
  });
}

/// @nodoc
class __$$BalanceStateImplCopyWithImpl<$Res>
    extends _$BalanceStateCopyWithImpl<$Res, _$BalanceStateImpl>
    implements _$$BalanceStateImplCopyWith<$Res> {
  __$$BalanceStateImplCopyWithImpl(
    _$BalanceStateImpl _value,
    $Res Function(_$BalanceStateImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of BalanceState
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? balanceUsdc = freezed,
    Object? promoActive = null,
    Object? promoCreditUsdc = freezed,
    Object? isLoading = null,
    Object? error = freezed,
    Object? previousBalance = freezed,
  }) {
    return _then(
      _$BalanceStateImpl(
        balanceUsdc: freezed == balanceUsdc
            ? _value.balanceUsdc
            : balanceUsdc // ignore: cast_nullable_to_non_nullable
                  as double?,
        promoActive: null == promoActive
            ? _value.promoActive
            : promoActive // ignore: cast_nullable_to_non_nullable
                  as bool,
        promoCreditUsdc: freezed == promoCreditUsdc
            ? _value.promoCreditUsdc
            : promoCreditUsdc // ignore: cast_nullable_to_non_nullable
                  as double?,
        isLoading: null == isLoading
            ? _value.isLoading
            : isLoading // ignore: cast_nullable_to_non_nullable
                  as bool,
        error: freezed == error
            ? _value.error
            : error // ignore: cast_nullable_to_non_nullable
                  as String?,
        previousBalance: freezed == previousBalance
            ? _value.previousBalance
            : previousBalance // ignore: cast_nullable_to_non_nullable
                  as double?,
      ),
    );
  }
}

/// @nodoc

class _$BalanceStateImpl implements _BalanceState {
  const _$BalanceStateImpl({
    this.balanceUsdc,
    this.promoActive = false,
    this.promoCreditUsdc,
    this.isLoading = true,
    this.error,
    this.previousBalance,
  });

  @override
  final double? balanceUsdc;
  @override
  @JsonKey()
  final bool promoActive;
  @override
  final double? promoCreditUsdc;
  @override
  @JsonKey()
  final bool isLoading;
  @override
  final String? error;
  @override
  final double? previousBalance;

  @override
  String toString() {
    return 'BalanceState(balanceUsdc: $balanceUsdc, promoActive: $promoActive, promoCreditUsdc: $promoCreditUsdc, isLoading: $isLoading, error: $error, previousBalance: $previousBalance)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$BalanceStateImpl &&
            (identical(other.balanceUsdc, balanceUsdc) ||
                other.balanceUsdc == balanceUsdc) &&
            (identical(other.promoActive, promoActive) ||
                other.promoActive == promoActive) &&
            (identical(other.promoCreditUsdc, promoCreditUsdc) ||
                other.promoCreditUsdc == promoCreditUsdc) &&
            (identical(other.isLoading, isLoading) ||
                other.isLoading == isLoading) &&
            (identical(other.error, error) || other.error == error) &&
            (identical(other.previousBalance, previousBalance) ||
                other.previousBalance == previousBalance));
  }

  @override
  int get hashCode => Object.hash(
    runtimeType,
    balanceUsdc,
    promoActive,
    promoCreditUsdc,
    isLoading,
    error,
    previousBalance,
  );

  /// Create a copy of BalanceState
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$BalanceStateImplCopyWith<_$BalanceStateImpl> get copyWith =>
      __$$BalanceStateImplCopyWithImpl<_$BalanceStateImpl>(this, _$identity);
}

abstract class _BalanceState implements BalanceState {
  const factory _BalanceState({
    final double? balanceUsdc,
    final bool promoActive,
    final double? promoCreditUsdc,
    final bool isLoading,
    final String? error,
    final double? previousBalance,
  }) = _$BalanceStateImpl;

  @override
  double? get balanceUsdc;
  @override
  bool get promoActive;
  @override
  double? get promoCreditUsdc;
  @override
  bool get isLoading;
  @override
  String? get error;
  @override
  double? get previousBalance;

  /// Create a copy of BalanceState
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$BalanceStateImplCopyWith<_$BalanceStateImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
