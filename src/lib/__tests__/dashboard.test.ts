import { describe, expect, it } from 'vitest';
import { buildDashboardCards, casesForDashboard, dashboardKind, filterReportCases, isApproaching, isPastNextAction, summarizeReportCases } from '../dashboard';
import type { CaseRow } from '../supabase';

const cases = [
  {id:'1',case_number:'A',institution_id:'i1',category:null,subject:null,status:'Pending',bureau_id:'p',assigned_officer_id:'u1',received_at:'2026-01-01',created_at:'2026-01-01',next_action_at:null,priority:null},
  {id:'2',case_number:'B',institution_id:'i2',category:null,subject:null,status:'Pending',bureau_id:'p',assigned_officer_id:'u2',received_at:'2026-01-01',created_at:'2026-01-01',next_action_at:null,priority:null},
  {id:'3',case_number:'C',institution_id:'i3',category:null,subject:null,status:'Pending',bureau_id:'rb',assigned_officer_id:null,received_at:'2026-01-01',created_at:'2026-01-01',next_action_at:null,priority:null},
] as CaseRow[];

describe('role dashboard scope',()=>{
  it('distinguishes explicit administrators, bureau managers, assigned officers, and AICTE oversight',()=>{
    expect(dashboardKind({active:true,is_admin:true,role:'aicte_official'})).toBe('administrator');
    expect(dashboardKind({active:true,is_admin:false,role:'pgrc_officer',can_manage_bureau:true})).toBe('bureau');
    expect(dashboardKind({active:true,is_admin:false,role:'pgrc_officer',can_manage_bureau:null,created_at:'2025-01-01T00:00:00.000Z'})).toBe('bureau');
    expect(dashboardKind({active:true,is_admin:false,role:'pgrc_officer',can_manage_bureau:false,created_at:'2025-01-01T00:00:00.000Z'})).toBe('officer');
    expect(dashboardKind({active:true,is_admin:false,role:'rb_officer',can_manage_bureau:false})).toBe('officer');
    expect(dashboardKind({active:true,is_admin:false,role:'bureau_officer',bureau_id:'regional-office',can_manage_bureau:false})).toBe('officer');
    expect(dashboardKind({active:true,is_admin:false,role:'bureau_officer',bureau_id:'regional-office',can_manage_bureau:true})).toBe('bureau');
    expect(dashboardKind({active:true,is_admin:false,role:'aicte_official'})).toBe('oversight');
    expect(dashboardKind({active:false,is_admin:true,role:'administrator'})).toBe('denied');
  });
  it('limits individual and Bureau dashboards to their assigned scope',()=>{
    expect(casesForDashboard(cases,'officer','u1',{bureau_id:'p'}).map(c=>c.id)).toEqual(['1']);
    expect(casesForDashboard(cases,'bureau','u1',{bureau_id:'p'}).map(c=>c.id)).toEqual(['1','2']);
    expect(casesForDashboard(cases,'administrator','admin',{})).toHaveLength(3);
  });
  it('does not invent an approaching-deadline window',()=>{
    const row={...cases[0],next_action_at:'2026-01-03T00:00:00.000Z'};
    expect(isApproaching(row,new Date('2026-01-01T00:00:00.000Z'))).toBe(false);
    expect(isApproaching(row,new Date('2026-01-01T00:00:00.000Z'),3)).toBe(true);
    expect(isPastNextAction(row,new Date('2026-01-04T00:00:00.000Z'))).toBe(true);
    expect(isPastNextAction({...row,next_action_at:null,expected_disposal_at:'2026-01-02'},new Date('2026-01-04T00:00:00.000Z'))).toBe(true);
  });
  it('filters report cases by inclusive receipt dates and Bureau/Cell',()=>{
    const scoped=filterReportCases(cases,{bureauId:'p',fromDate:'2026-01-01',toDate:'2026-01-01'});
    expect(scoped.map(row=>row.id)).toEqual(['1','2']);
    expect(filterReportCases(cases,{bureauId:'missing'})).toEqual([]);
    expect(filterReportCases(cases,{})).toHaveLength(3);
  });
  it('summarizes report metrics from filtered case records without assuming SLAs',()=>{
    const rows=[
      {...cases[0],status:'Pending',next_action_at:'2026-01-02'},
      {...cases[1],status:'Under Process',next_action_at:null,expected_disposal_at:'2026-01-04'},
      {...cases[2],status:'Disposed',next_action_at:'2025-12-01'},
    ];
    expect(summarizeReportCases(rows,new Date('2026-01-05T00:00:00.000Z'))).toEqual({total:3,pending:1,underProcess:1,disposed:1,overdue:2,disposalRate:33});
    expect(summarizeReportCases([]).disposalRate).toBeNull();
  });

  it('does not present a failed relationship summary as a genuine zero',()=>{
    const cards=buildDashboardCards('administrator',cases,null,[],[],[],{id:'admin',is_admin:true});
    expect(cards.find(([label])=>label==='Potential relationships')?.[1]).toBe('Unavailable');
    expect(cards.find(([label])=>label==='Cases requiring attention')?.[1]).toBe('Unavailable');
  });
  it('uses the database relationship summary for dashboard counts and affected cases',()=>{
    const summary={pending_count:2,case_ids:['1','3'],by_bureau:[],recent:[]};
    const cards=buildDashboardCards('administrator',cases,summary,[],[],[],{id:'admin',is_admin:true});
    expect(cards.find(([label])=>label==='Potential relationships')?.[1]).toBe(2);
    expect(cards.find(([label])=>label==='Cases requiring attention')?.[1]).toBe(2);
  });
  it('uses exact Bureau transfer counts without loading transfer history on the dashboard',()=>{
    const transferCounts={inBureau:4,outBureau:2};
    const cards=buildDashboardCards('bureau',cases,{},[],transferCounts,[],{id:'manager',bureau_id:'p'});
    expect(cards.find(([label])=>label==='Transferred in')?.[1]).toBe(4);
    expect(cards.find(([label])=>label==='Transferred out')?.[1]).toBe(2);
  });
  it('does not render missing Bureau transfer counts as a genuine zero',()=>{
    const cards=buildDashboardCards('bureau',cases,{},[],null,[],{id:'manager',bureau_id:'p'});
    expect(cards.find(([label])=>label==='Transferred in')?.[1]).toBe('Unavailable');
    expect(cards.find(([label])=>label==='Transferred out')?.[1]).toBe('Unavailable');
  });
});
