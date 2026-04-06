import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/models/graph_data.dart';
import '../../core/api/models/memory_stats.dart';
import '../../core/api/models/memory_summary.dart';
import '../../core/auth/auth_provider.dart';
import '../../shared/utils/relative_time.dart';
import 'entities_tab.dart';
import 'force_graph_widget.dart';
import 'health_tab.dart';
import 'graph_provider.dart';
import 'import_pack_sheet.dart';
import 'memory_stats_provider.dart';
import 'recent_memories_provider.dart';

const kMemoryTypeColors = <String, Color>{
  'episodic': Color(0xFF2244FF),
  'semantic': Color(0xFF10B981),
  'procedural': Color(0xFFF59E0B),
  'self_model': Color(0xFF8B5CF6),
};

const _typeDisplayNames = <String, String>{
  'episodic': 'Episodic',
  'semantic': 'Semantic',
  'procedural': 'Procedural',
  'self_model': 'Self Model',
};

const _typeOrder = ['episodic', 'semantic', 'procedural', 'self_model'];

class MemoryPanelScreen extends ConsumerWidget {
  const MemoryPanelScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authNotifierProvider);

    if (!auth.isAuthenticated) {
      return Scaffold(
        appBar: AppBar(title: const Text('Memory')),
        body: const _AuthGate(),
      );
    }

    return DefaultTabController(
      length: 4,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Memory'),
          actions: [
            IconButton(
              icon: const Icon(Icons.download),
              tooltip: 'Import Pack',
              onPressed: () => showModalBottomSheet(
                context: context,
                builder: (_) => const ImportPackSheet(),
              ),
            ),
          ],
          bottom: const TabBar(
            tabs: [
              Tab(text: 'Feed'),
              Tab(text: 'Graph'),
              Tab(text: 'Entities'),
              Tab(text: 'Health'),
            ],
          ),
        ),
        body: const TabBarView(
          children: [
            _FeedTab(),
            _GraphTab(),
            EntitiesTab(),
            HealthTab(),
          ],
        ),
      ),
    );
  }
}

class _GraphTab extends ConsumerWidget {
  const _GraphTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncGraph = ref.watch(graphProvider);

    return asyncGraph.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline, size: 48,
                color: Theme.of(context).colorScheme.error),
            const SizedBox(height: 12),
            Text(error.toString(), textAlign: TextAlign.center),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: () => ref.invalidate(graphProvider),
              child: const Text('Retry'),
            ),
          ],
        ),
      ),
      data: (graph) => ForceGraphWidget(graph: graph),
    );
  }
}

class _AuthGate extends StatelessWidget {
  const _AuthGate();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.lock_outline, size: 48,
              color: Theme.of(context).colorScheme.onSurface.withAlpha(100)),
          const SizedBox(height: 12),
          const Text('Sign in to view your memories'),
        ],
      ),
    );
  }
}

class _FeedTab extends ConsumerStatefulWidget {
  const _FeedTab();

  @override
  ConsumerState<_FeedTab> createState() => _FeedTabState();
}

class _FeedTabState extends ConsumerState<_FeedTab> {
  final _scrollController = ScrollController();
  String? _selectedType; // null = "All"
  String _selectedRange = '24h';

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 200) {
      ref.read(recentMemoriesProvider.notifier).loadMore();
    }
  }

  @override
  Widget build(BuildContext context) {
    final asyncStats = ref.watch(memoryStatsProvider);
    final recentState = ref.watch(recentMemoriesProvider);
    final muted = Theme.of(context).colorScheme.onSurface.withAlpha(100);

    return RefreshIndicator(
      onRefresh: () async {
        await Future.wait([
          ref.read(memoryStatsProvider.notifier).refresh(),
          ref.read(recentMemoriesProvider.notifier).refresh(),
        ]);
      },
      child: CustomScrollView(
        controller: _scrollController,
        slivers: [
          // Compact horizontal stats bar
          SliverToBoxAdapter(
            child: asyncStats.when(
              loading: () => const SizedBox.shrink(),
              error: (_, __) => const SizedBox.shrink(),
              data: (stats) => SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                child: Row(
                  children: [
                    _StatChip(
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text('${stats.total}',
                              style: const TextStyle(
                                  fontSize: 13, fontWeight: FontWeight.w600)),
                          const SizedBox(width: 5),
                          Text('memories',
                              style: TextStyle(fontSize: 10, color: muted)),
                        ],
                      ),
                    ),
                    const SizedBox(width: 6),
                    ..._typeOrder.map((type) {
                      final count = stats.byType[type] ?? 0;
                      final color = kMemoryTypeColors[type] ?? Colors.grey;
                      return Padding(
                        padding: const EdgeInsets.only(right: 6),
                        child: _StatChip(
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Container(
                                width: 6, height: 6,
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: color,
                                ),
                              ),
                              const SizedBox(width: 4),
                              Text('$count',
                                  style: TextStyle(fontSize: 10, color: muted)),
                            ],
                          ),
                        ),
                      );
                    }),
                  ],
                ),
              ),
            ),
          ),

          // Search bar
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: TextField(
                decoration: InputDecoration(
                  hintText: 'Search memories...',
                  prefixIcon: const Icon(Icons.search, size: 18),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  isDense: true,
                  contentPadding: const EdgeInsets.symmetric(vertical: 10),
                ),
              ),
            ),
          ),

          // Type filter chips
          SliverToBoxAdapter(
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              child: Row(
                children: [
                  _FilterChip(
                    label: 'All',
                    selected: _selectedType == null,
                    onTap: () => setState(() => _selectedType = null),
                  ),
                  const SizedBox(width: 6),
                  ..._typeOrder.map((type) {
                    final color = kMemoryTypeColors[type] ?? Colors.grey;
                    final name = _typeDisplayNames[type] ?? type;
                    return Padding(
                      padding: const EdgeInsets.only(right: 6),
                      child: _FilterChip(
                        label: name,
                        dotColor: color,
                        selected: _selectedType == type,
                        onTap: () => setState(() => _selectedType = type),
                      ),
                    );
                  }),
                ],
              ),
            ),
          ),

          // Time range buttons
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Row(
                children: ['24h', '3d', '1w', '30d'].map((range) {
                  final selected = _selectedRange == range;
                  return Padding(
                    padding: const EdgeInsets.only(right: 4),
                    child: GestureDetector(
                      onTap: () => setState(() => _selectedRange = range),
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(20),
                          color: selected
                              ? const Color(0xFF2244FF).withAlpha(30)
                              : Colors.transparent,
                          border: Border.all(
                            color: selected
                                ? const Color(0xFF2244FF).withAlpha(64)
                                : Theme.of(context)
                                    .colorScheme
                                    .outline
                                    .withAlpha(40),
                          ),
                        ),
                        child: Text(
                          range,
                          style: TextStyle(
                            fontSize: 10,
                            color: selected
                                ? Theme.of(context).colorScheme.onSurface
                                : muted,
                          ),
                        ),
                      ),
                    ),
                  );
                }).toList(),
              ),
            ),
          ),

          // Memory feed list
          ..._buildFeedSlivers(recentState),

          // Import Memory Pack button
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: OutlinedButton.icon(
                onPressed: () => showModalBottomSheet(
                  context: context,
                  builder: (_) => const ImportPackSheet(),
                ),
                icon: const Icon(Icons.download, size: 16),
                label: const Text('Import Memory Pack'),
              ),
            ),
          ),
        ],
      ),
    );
  }

  List<Widget> _buildFeedSlivers(recentState) {
    if (recentState.isLoading && recentState.items.isEmpty) {
      return [
        const SliverToBoxAdapter(
          child: Center(
              child: Padding(
            padding: EdgeInsets.all(32),
            child: CircularProgressIndicator(),
          )),
        ),
      ];
    }

    if (recentState.error != null && recentState.items.isEmpty) {
      return [
        SliverToBoxAdapter(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(32),
              child: Column(
                children: [
                  Text(recentState.error!),
                  const SizedBox(height: 8),
                  ElevatedButton(
                    onPressed: () =>
                        ref.read(recentMemoriesProvider.notifier).fetch(),
                    child: const Text('Retry'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ];
    }

    final items = _selectedType == null
        ? recentState.items
        : recentState.items
            .where((m) => m.memoryType == _selectedType)
            .toList();

    if (!recentState.isLoading && items.isEmpty) {
      return [
        const SliverToBoxAdapter(
          child: Center(
            child: Padding(
              padding: EdgeInsets.all(32),
              child: Text('No memories yet'),
            ),
          ),
        ),
      ];
    }

    return [
      SliverList.builder(
        itemCount: items.length,
        itemBuilder: (context, index) => MemoryTile(memory: items[index]),
      ),
      if (recentState.hasMore && _selectedType == null)
        const SliverToBoxAdapter(
          child: Center(
            child: Padding(
              padding: EdgeInsets.all(16),
              child: CircularProgressIndicator(),
            ),
          ),
        ),
    ];
  }
}

class _StatChip extends StatelessWidget {
  const _StatChip({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border.all(
          color: Theme.of(context).colorScheme.outline.withAlpha(40),
        ),
        borderRadius: BorderRadius.circular(20),
      ),
      child: child,
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.label,
    required this.selected,
    required this.onTap,
    this.dotColor,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;
  final Color? dotColor;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(20),
          color: selected
              ? const Color(0xFF2244FF).withAlpha(30)
              : Colors.transparent,
          border: Border.all(
            color: selected
                ? const Color(0xFF2244FF).withAlpha(64)
                : Theme.of(context).colorScheme.outline.withAlpha(40),
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (dotColor != null) ...[
              Container(
                width: 6, height: 6,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: dotColor,
                ),
              ),
              const SizedBox(width: 4),
            ],
            Text(
              label,
              style: TextStyle(
                fontSize: 11,
                color: selected
                    ? Theme.of(context).colorScheme.onSurface
                    : Theme.of(context).colorScheme.onSurface.withAlpha(150),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// -- Type badge label mapping --
const _typeBadgeLabels = <String, String>{
  'episodic': 'EPI',
  'semantic': 'SEM',
  'procedural': 'PRO',
  'self_model': 'SLF',
};

Color _importanceColor(double importance) {
  if (importance >= 0.7) return Colors.green.shade400;
  if (importance >= 0.4) return Colors.amber.shade400;
  return Colors.red.shade400;
}

class MemoryTile extends StatefulWidget {
  const MemoryTile({super.key, required this.memory});
  final MemorySummary memory;

  @override
  State<MemoryTile> createState() => _MemoryTileState();
}

class _MemoryTileState extends State<MemoryTile> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final m = widget.memory;
    final color = kMemoryTypeColors[m.memoryType] ?? Colors.grey;
    final label = _typeBadgeLabels[m.memoryType] ??
        m.memoryType.substring(0, 3).toUpperCase();
    final dotSize = 4.0 + (m.importance.clamp(0.0, 1.0) * 6.0);

    return InkWell(
      onTap: () => setState(() => _expanded = !_expanded),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: color.withAlpha(38),
                borderRadius: BorderRadius.circular(4),
                border: Border.all(color: color.withAlpha(100)),
              ),
              child: Text(
                label,
                style: TextStyle(
                  fontSize: 10,
                  color: color,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  AnimatedSize(
                    duration: const Duration(milliseconds: 200),
                    alignment: Alignment.topLeft,
                    child: Text(
                      m.summary,
                      maxLines: _expanded ? null : 2,
                      overflow: _expanded ? null : TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Container(
                        width: dotSize,
                        height: dotSize,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: _importanceColor(m.importance),
                        ),
                      ),
                      const SizedBox(width: 6),
                      Text(
                        relativeTime(m.createdAt),
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: Theme.of(context)
                                  .colorScheme
                                  .onSurface
                                  .withAlpha(100),
                            ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
