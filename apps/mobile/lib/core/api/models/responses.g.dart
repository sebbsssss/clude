// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'responses.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_$AutoRegisterResponseImpl _$$AutoRegisterResponseImplFromJson(
  Map<String, dynamic> json,
) => _$AutoRegisterResponseImpl(
  apiKey: json['api_key'] as String,
  agentId: json['agent_id'] as String,
  created: json['created'] as bool,
);

Map<String, dynamic> _$$AutoRegisterResponseImplToJson(
  _$AutoRegisterResponseImpl instance,
) => <String, dynamic>{
  'api_key': instance.apiKey,
  'agent_id': instance.agentId,
  'created': instance.created,
};

_$BalanceImpl _$$BalanceImplFromJson(Map<String, dynamic> json) =>
    _$BalanceImpl(
      balanceUsdc: (json['balance_usdc'] as num).toDouble(),
      walletAddress: json['wallet_address'] as String?,
      promo: json['promo'] as bool?,
      promoCreditUsdc: (json['promo_credit_usdc'] as num?)?.toDouble(),
    );

Map<String, dynamic> _$$BalanceImplToJson(_$BalanceImpl instance) =>
    <String, dynamic>{
      'balance_usdc': instance.balanceUsdc,
      'wallet_address': instance.walletAddress,
      'promo': instance.promo,
      'promo_credit_usdc': instance.promoCreditUsdc,
    };

_$TopupIntentImpl _$$TopupIntentImplFromJson(Map<String, dynamic> json) =>
    _$TopupIntentImpl(
      id: json['id'] as String,
      walletAddress: json['wallet_address'] as String,
      amountUsdc: (json['amount_usdc'] as num).toDouble(),
      chain: json['chain'] as String,
      destAddress: json['dest_address'] as String,
      solanaPayUrl: json['solana_pay_url'] as String?,
      reference: json['reference'] as String?,
    );

Map<String, dynamic> _$$TopupIntentImplToJson(_$TopupIntentImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'wallet_address': instance.walletAddress,
      'amount_usdc': instance.amountUsdc,
      'chain': instance.chain,
      'dest_address': instance.destAddress,
      'solana_pay_url': instance.solanaPayUrl,
      'reference': instance.reference,
    };

_$TopupConfirmationImpl _$$TopupConfirmationImplFromJson(
  Map<String, dynamic> json,
) => _$TopupConfirmationImpl(
  status: json['status'] as String,
  balanceUsdc: (json['balance_usdc'] as num).toDouble(),
);

Map<String, dynamic> _$$TopupConfirmationImplToJson(
  _$TopupConfirmationImpl instance,
) => <String, dynamic>{
  'status': instance.status,
  'balance_usdc': instance.balanceUsdc,
};

_$TopupStatusImpl _$$TopupStatusImplFromJson(Map<String, dynamic> json) =>
    _$TopupStatusImpl(
      status: json['status'] as String,
      amountUsdc: (json['amount_usdc'] as num?)?.toDouble(),
      txHash: json['tx_hash'] as String?,
      balanceUsdc: (json['balance_usdc'] as num?)?.toDouble(),
    );

Map<String, dynamic> _$$TopupStatusImplToJson(_$TopupStatusImpl instance) =>
    <String, dynamic>{
      'status': instance.status,
      'amount_usdc': instance.amountUsdc,
      'tx_hash': instance.txHash,
      'balance_usdc': instance.balanceUsdc,
    };

_$ImportResultImpl _$$ImportResultImplFromJson(Map<String, dynamic> json) =>
    _$ImportResultImpl(imported: (json['imported'] as num).toInt());

Map<String, dynamic> _$$ImportResultImplToJson(_$ImportResultImpl instance) =>
    <String, dynamic>{'imported': instance.imported};

_$MessageReceiptImpl _$$MessageReceiptImplFromJson(Map<String, dynamic> json) =>
    _$MessageReceiptImpl(
      costUsdc: (json['cost_usdc'] as num).toDouble(),
      equivalentDirectCost: (json['equivalent_direct_cost'] as num).toDouble(),
      savingsPct: (json['savings_pct'] as num).toDouble(),
      remainingBalance: (json['remaining_balance'] as num?)?.toDouble(),
    );

Map<String, dynamic> _$$MessageReceiptImplToJson(
  _$MessageReceiptImpl instance,
) => <String, dynamic>{
  'cost_usdc': instance.costUsdc,
  'equivalent_direct_cost': instance.equivalentDirectCost,
  'savings_pct': instance.savingsPct,
  'remaining_balance': instance.remainingBalance,
};

_$StreamDoneDataImpl _$$StreamDoneDataImplFromJson(Map<String, dynamic> json) =>
    _$StreamDoneDataImpl(
      done: json['done'] as bool? ?? true,
      messageId: json['message_id'] as String?,
      model: json['model'] as String?,
      memoriesUsed: (json['memories_used'] as num?)?.toInt(),
      memoryIds: (json['memory_ids'] as List<dynamic>?)
          ?.map((e) => (e as num).toInt())
          .toList(),
      cost: json['cost'] as Map<String, dynamic>?,
      tokens: json['tokens'] as Map<String, dynamic>?,
      receipt: json['receipt'] == null
          ? null
          : MessageReceipt.fromJson(json['receipt'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$$StreamDoneDataImplToJson(
  _$StreamDoneDataImpl instance,
) => <String, dynamic>{
  'done': instance.done,
  'message_id': instance.messageId,
  'model': instance.model,
  'memories_used': instance.memoriesUsed,
  'memory_ids': instance.memoryIds,
  'cost': instance.cost,
  'tokens': instance.tokens,
  'receipt': instance.receipt,
};

_$TemporalSpanImpl _$$TemporalSpanImplFromJson(Map<String, dynamic> json) =>
    _$TemporalSpanImpl(
      weeks: (json['weeks'] as num).toInt(),
      sinceLabel: json['since_label'] as String,
    );

Map<String, dynamic> _$$TemporalSpanImplToJson(_$TemporalSpanImpl instance) =>
    <String, dynamic>{
      'weeks': instance.weeks,
      'since_label': instance.sinceLabel,
    };

_$GreetingMetaImpl _$$GreetingMetaImplFromJson(
  Map<String, dynamic> json,
) => _$GreetingMetaImpl(
  totalMemories: (json['total_memories'] as num).toInt(),
  memoriesRecalled: (json['memories_recalled'] as num).toInt(),
  temporalSpan: json['temporal_span'] == null
      ? null
      : TemporalSpan.fromJson(json['temporal_span'] as Map<String, dynamic>),
  topics: (json['topics'] as List<dynamic>).map((e) => e as String).toList(),
  greetingCost: (json['greeting_cost'] as num).toDouble(),
);

Map<String, dynamic> _$$GreetingMetaImplToJson(_$GreetingMetaImpl instance) =>
    <String, dynamic>{
      'total_memories': instance.totalMemories,
      'memories_recalled': instance.memoriesRecalled,
      'temporal_span': instance.temporalSpan,
      'topics': instance.topics,
      'greeting_cost': instance.greetingCost,
    };

_$UsageRecordImpl _$$UsageRecordImplFromJson(Map<String, dynamic> json) =>
    _$UsageRecordImpl(
      date: json['date'] as String,
      promptTokens: (json['prompt_tokens'] as num).toInt(),
      completionTokens: (json['completion_tokens'] as num).toInt(),
      costUsdc: (json['cost_usdc'] as num).toDouble(),
      conversationCount: (json['conversation_count'] as num).toInt(),
    );

Map<String, dynamic> _$$UsageRecordImplToJson(_$UsageRecordImpl instance) =>
    <String, dynamic>{
      'date': instance.date,
      'prompt_tokens': instance.promptTokens,
      'completion_tokens': instance.completionTokens,
      'cost_usdc': instance.costUsdc,
      'conversation_count': instance.conversationCount,
    };

_$TopupRecordImpl _$$TopupRecordImplFromJson(Map<String, dynamic> json) =>
    _$TopupRecordImpl(
      id: json['id'] as String,
      amountUsdc: (json['amount_usdc'] as num).toDouble(),
      chain: json['chain'] as String,
      txHash: json['tx_hash'] as String?,
      status: json['status'] as String,
      createdAt: json['created_at'] as String,
    );

Map<String, dynamic> _$$TopupRecordImplToJson(_$TopupRecordImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'amount_usdc': instance.amountUsdc,
      'chain': instance.chain,
      'tx_hash': instance.txHash,
      'status': instance.status,
      'created_at': instance.createdAt,
    };
