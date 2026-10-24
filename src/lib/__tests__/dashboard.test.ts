import { describe, expect, it } from 'vitest';
import { casesForDashboard, dashboardKind, isApproaching, isPastNextAction } from '../dashboard';
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
  });
});
